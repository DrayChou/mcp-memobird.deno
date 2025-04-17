import { Buffer } from "jsr:@std/io/buffer";
import { encodeBase64, decodeBase64 } from "jsr:@std/encoding/base64";
import { format } from "jsr:@std/datetime/format";
// 注意：Deno 标准库没有内置的完整图像处理功能（如调整大小、转换为 1 位 BMP）。
// 这个客户端目前不执行图像处理，仅传递 Base64 数据。
// 如果需要完整的图像处理，请集成第三方 Deno 图像库。

// --- 常量 ---
const MEMOBIRD_API_BASE_URL = "http://open.memobird.cn/home";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000; // 毫秒

// --- 自定义错误 ---
export class MemobirdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemobirdError";
  }
}

export class ApiError extends MemobirdError {
  public resCode: number;
  public resError: string;
  public statusCode?: number;

  constructor(resCode: number, resError: string, statusCode?: number) {
    super(`API Error (HTTP Status: ${statusCode ?? 'N/A'}, API Code: ${resCode}): ${resError}`);
    this.name = "ApiError";
    this.resCode = resCode;
    this.resError = resError;
    this.statusCode = statusCode;
  }
}

export class NetworkError extends MemobirdError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NetworkError";
    if (cause instanceof Error) {
        this.cause = cause;
    }
  }
}

export class ContentError extends MemobirdError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ContentError";
     if (cause instanceof Error) {
        this.cause = cause;
    }
  }
}


// --- 辅助函数 ---
function currentTimestamp(): string {
  // API 需要 'YYYY-MM-DD HH:mm:ss' 格式
  return format(new Date(), "yyyy-MM-dd HH:mm:ss");
}

// --- API 响应处理 ---
async function checkApiResponse(resp: Response): Promise<any> {
  let responseText = "";
  try {
    responseText = await resp.text(); // 先获取文本以防 JSON 解析失败
    if (!resp.ok) {
      throw new NetworkError(`HTTP Error: ${resp.status} ${resp.statusText}. Response: ${responseText.substring(0, 200)}...`, new Error(resp.statusText));
    }
    const data = JSON.parse(responseText);

    // API 成功代码为 1
    if (data?.showapi_res_code !== 1) {
      throw new ApiError(
        data?.showapi_res_code ?? -1,
        data?.showapi_res_error ?? "Unknown API error",
        resp.status,
      );
    }
    return data;
  } catch (e) {
    if (e instanceof SyntaxError) { // JSON 解析错误
      throw new ApiError(
        -2,
        `Failed to decode JSON response: ${e.message}. Response text: ${responseText.substring(0, 100)}...`,
        resp.status,
      );
    }
    // 重新抛出已知的 MemobirdError 或包装其他错误
    if (e instanceof MemobirdError) {
        throw e;
    }
    throw new NetworkError(`Failed to process API response: ${e instanceof Error ? e.message : String(e)}`, e);
  }
}


// --- 内容构建器 ---
type PayloadPart = { type: "T"; data: string } | { type: "P"; data: Uint8Array };

export class PrintPayloadBuilder {
  private parts: PayloadPart[] = [];

  addText(text: string): this {
    if (typeof text !== 'string') {
      throw new TypeError("Text content must be a string.");
    }
    console.debug("Adding text part.");
    // 注意：API 可能需要 GBK 编码，但 Deno 的 TextEncoder 默认为 UTF-8。
    // 这里我们使用 UTF-8。如果打印出乱码，可能需要寻找 GBK 编码库。
    this.parts.push({ type: "T", data: text });
    return this; // 允许链式调用
  }

  // 注意：此函数目前不处理图像，只接受原始字节
  // 在实际应用中，您需要先用图像库处理图像（调整大小、转换为 1 位 BMP）
  // 然后将 BMP 图像的字节传递给此方法。
  addImageBytes(imageBytes: Uint8Array): this {
      console.debug(`Adding image part (bytes length: ${imageBytes.length})`);
      this.parts.push({ type: "P", data: imageBytes });
      return this;
  }

  // 添加 Base64 编码的图像数据
  addBase64Image(base64Data: string): this {
      console.debug("Adding base64 image part.");
      try {
          const imageBytes = decodeBase64(base64Data);
          return this.addImageBytes(imageBytes);
      } catch (e) {
          throw new ContentError(`Failed to decode base64 image data: ${e instanceof Error ? e.message : String(e)}`, e);
      }
  }


  build(): string {
    const encodedParts: string[] = [];
    const numParts = this.parts.length;
    const textEncoder = new TextEncoder(); // 默认 UTF-8

    for (let i = 0; i < numParts; i++) {
      const part = this.parts[i];
      try {
        if (part.type === "T") {
          let textData = part.data;
          // 如果不是最后一部分且不以换行符结尾，则添加换行符
          if (i < numParts - 1 && !textData.endsWith("\n")) {
            textData += "\n";
          }
          // **编码注意**: API 可能需要 GBK，这里使用 UTF-8
          const encodedBytes = textEncoder.encode(textData);
          const encodedBase64 = encodeBase64(encodedBytes);
          encodedParts.push(`T:${encodedBase64}`);
        } else if (part.type === "P") {
          // 图像数据已经是 Uint8Array
          const encodedBase64 = encodeBase64(part.data);
          encodedParts.push(`P:${encodedBase64}`);
        }
      } catch (e) {
        console.error(`Error encoding part (Type: ${part.type}): ${e instanceof Error ? e.message : String(e)}. Skipping part.`);
        // 或者抛出 ContentError
        // throw new ContentError(`Error encoding part (Type: ${part.type}): ${e.message}`, e);
      }
    }

    const payload = encodedParts.join("|");
    console.debug(`Built payload string (length: ${payload.length}): ${payload.substring(0, 50)}...`);
    return payload;
  }
}


// --- API 客户端 ---
export class MemobirdApiClient {
  private ak: string;
  private headers: HeadersInit;

  constructor(ak: string) {
    if (!ak) {
      throw new ValueError("Memobird API Key (ak) cannot be empty.");
    }
    this.ak = ak;
    this.headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    console.info("MemobirdApiClient initialized.");
  }

  private async makeRequest(
    method: string,
    path: string,
    params?: Record<string, string>,
    jsonData?: Record<string, unknown>,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<any> {
    const url = new URL(MEMOBIRD_API_BASE_URL + path);
    if (params) {
      Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
    }

    console.debug(`Making ${method} request to ${url} with params=${JSON.stringify(params)}, json=${JSON.stringify(jsonData)}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetch(url.toString(), {
            method: method,
            headers: this.headers,
            body: jsonData ? JSON.stringify(jsonData) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timeoutId); // 清除超时计时器
        return await checkApiResponse(resp); // 返回 JSON 数据或抛出错误
    } catch (e) {
        clearTimeout(timeoutId); // 确保清除超时
        if (e instanceof DOMException && e.name === 'AbortError') {
             throw new NetworkError(`Request timed out after ${timeoutMs}ms`, e);
        }
         // 重新抛出已知的 MemobirdError 或包装其他错误
        if (e instanceof MemobirdError) {
            throw e;
        }
        throw new NetworkError(`Unexpected error during API request: ${e instanceof Error ? e.message : String(e)}`, e);
    }
  }

  async getUserId(deviceId: string, userIdentifying: string = ""): Promise<string> {
    const path = "/setuserbind";
    const params = {
      ak: this.ak,
      timestamp: currentTimestamp(),
      memobirdID: deviceId,
      useridentifying: userIdentifying,
    };
    console.info(`Getting user ID for device ${deviceId}...`);
    const apiData = await this.makeRequest("GET", path, params);
    const userId = apiData?.showapi_userid;
    if (!userId) {
      throw new ApiError(
        apiData?.showapi_res_code ?? -1,
        "User ID not found in successful API response.",
        apiData?.statusCode // statusCode 可能不存在，需要检查
      );
    }
    console.info(`Obtained user ID: ${userId}`);
    return String(userId); // 确保是字符串
  }

  async printContent(deviceId: string, userId: string, payloadBuilder: PrintPayloadBuilder): Promise<number> {
    const path = "/printpaper";
    const contentString = payloadBuilder.build();
    if (!contentString) {
      console.warn("Content payload is empty, nothing to print.");
      throw new ContentError("Cannot print empty content.");
    }

    const jsonData = {
      ak: this.ak,
      timestamp: currentTimestamp(),
      printcontent: contentString,
      memobirdID: deviceId,
      userID: userId,
    };
    console.info(`Sending content to device ${deviceId} (User: ${userId})...`);
    // 打印可能需要更长的时间
    const apiData = await this.makeRequest("POST", path, undefined, jsonData, 20000);
    const contentId = apiData?.printcontentid;
    if (contentId === undefined || contentId === null) {
      throw new ApiError(
        apiData?.showapi_res_code ?? -1,
        "Content ID not found in successful print API response.",
        apiData?.statusCode
      );
    }
    console.info(`Print request successful. Content ID: ${contentId}`);
    return Number(contentId); // API 返回 int
  }

  async printUrl(deviceId: string, userId: string, url: string): Promise<number> {
      const path = "/printpaperFromUrl";
      const jsonData = {
          ak: this.ak,
          timestamp: currentTimestamp(),
          printUrl: url,
          memobirdID: deviceId,
          userID: userId,
      };
      console.info(`Sending URL ${url} to device ${deviceId} (User: ${userId})...`);
      // URL 打印可能需要更长时间
      const apiData = await this.makeRequest("POST", path, undefined, jsonData, 30000);
      const contentId = apiData?.printcontentid;
      if (contentId === undefined || contentId === null) {
          throw new ApiError(
              apiData?.showapi_res_code ?? -1,
              "Content ID not found in successful print URL API response.",
              apiData?.statusCode
          );
      }
      console.info(`Print URL request successful. Content ID: ${contentId}`);
      return Number(contentId);
  }


  async checkPrintStatus(contentId: number): Promise<boolean> {
    const path = "/getprintstatus";
    const params = {
      ak: this.ak,
      timestamp: currentTimestamp(),
      printcontentid: String(contentId), // API 需要字符串
    };
    console.info(`Checking print status for Content ID: ${contentId}...`);
    const apiData = await this.makeRequest("GET", path, params);
    const isPrinted = apiData?.printflag === 1;
    console.info(`Print status for ${contentId}: ${isPrinted ? 'Printed' : 'Not Printed/Pending'}`);
    return isPrinted;
  }
}

// --- 设备接口 ---
// ValueError 在 TypeScript 中通常用 Error 或 RangeError/TypeError 代替
class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

export class MemobirdDevice {
  private client: MemobirdApiClient;
  public deviceId: string;
  public userId: string = ""; // 初始化为空字符串

  // 使构造函数异步，因为它需要调用 API 获取 userId
  private constructor(ak: string, deviceId: string) {
      console.info(`Initializing MemobirdDevice for device: ${deviceId}...`);
      this.client = new MemobirdApiClient(ak); // 可能抛出 ValueError
      this.deviceId = deviceId;
  }

  // 静态工厂方法来处理异步初始化
  public static async create(ak: string, deviceId: string, userIdentifying: string = ""): Promise<MemobirdDevice> {
       const instance = new MemobirdDevice(ak, deviceId);
       // getUserId 可能抛出 ApiError 或 NetworkError
       instance.userId = await instance.client.getUserId(instance.deviceId, userIdentifying);
       console.info(`MemobirdDevice initialized for User ID: ${instance.userId}.`);
       return instance;
   }


  async printText(text: string): Promise<number> {
    const payload = new PrintPayloadBuilder().addText(text);
    // printContent 可能抛出 ApiError, NetworkError, ContentError
    return await this.client.printContent(this.deviceId, this.userId, payload);
  }

  // 注意：此方法目前只接受 Base64 编码的图像数据字符串
  // 它不处理文件路径或执行图像处理。
  async printImage(base64ImageData: string): Promise<number> {
      try {
          const payload = new PrintPayloadBuilder().addBase64Image(base64ImageData);
          // printContent 可能抛出 ApiError, NetworkError
          return await this.client.printContent(this.deviceId, this.userId, payload);
      } catch (e) {
          // 记录并重新抛出 ContentError 或其他错误
          console.error(`Failed to prepare image for printing: ${e instanceof Error ? e.message : String(e)}`);
          if (e instanceof MemobirdError) {
              throw e;
          }
          throw new ContentError(`Failed to prepare image for printing: ${e instanceof Error ? e.message : String(e)}`, e);
      }
  }

  async printPayload(payload: PrintPayloadBuilder): Promise<number> {
    // printContent 可能抛出 ApiError, NetworkError, ContentError (如果 build 失败)
    return await this.client.printContent(this.deviceId, this.userId, payload);
  }

  async printUrl(url: string): Promise<number> {
      // printUrl 可能抛出 ApiError, NetworkError
      return await this.client.printUrl(this.deviceId, this.userId, url);
  }

  async checkPrintStatus(contentId: number): Promise<boolean> {
    // checkPrintStatus 可能抛出 ApiError, NetworkError
    return await this.client.checkPrintStatus(contentId);
  }
}