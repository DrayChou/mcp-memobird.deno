import { McpServer } from "npm:@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "npm:@modelcontextprotocol/sdk/server/sse.js";
import { z } from "npm:zod";
import { parseArgs } from "jsr:@std/cli/parse-args";
import { MemobirdDevice, ApiError, NetworkError, ContentError, MemobirdError } from "./client.ts";
import * as http from "node:http";

// --- 配置 ---
const SERVER_NAME = "Memobird Printer Server (Deno)";
const DEFAULT_SSE_PORT = 8001; // 与 Python 版本使用不同端口以避免冲突

// --- 全局变量 ---
let bird: MemobirdDevice | null = null; // Memobird 设备实例

// --- 命令行参数定义 ---
// 使用 Deno 的 std/cli 解析参数
const flags = parseArgs(Deno.args, {
    string: ["transport", "ak", "did", "port"],
    boolean: ["help"],
    alias: {
        "transport": "t",
        "port": "p",
        "access_key": "ak", // 允许 --access_key
        "device_id": "did", // 允许 --device_id
        "help": "h",
    },
    default: {
        transport: "stdio",
        port: String(DEFAULT_SSE_PORT), // 默认值需为字符串
    },
});

function printHelp() {
    console.log(`Usage: deno run --allow-net --allow-env --allow-read src/main.ts [options]`);
    console.log("\nOptions:");
    console.log(`  -t, --transport <stdio|sse> Transport protocol to use (default: stdio)`);
    console.log(`  -p, --port <number>         Port for SSE server (default: ${DEFAULT_SSE_PORT})`);
    console.log(`      --ak, --access_key <key> Memobird API Key (or use MEMOBIRD_AK env var)`);
    console.log(`      --did, --device_id <id>  Memobird Device ID (or use MEMOBIRD_DEVICE_ID env var)`);
    console.log(`  -h, --help                  Show this help message`);
    console.log("\nEnvironment Variables:");
    console.log(`  MEMOBIRD_AK:         Memobird API Key`);
    console.log(`  MEMOBIRD_DEVICE_ID:  Memobird Device ID`);
}

// --- 主函数 ---
async function main() {
    if (flags.help) {
        printHelp();
        Deno.exit(0);
    }

    // --- 确定凭据 (CLI 参数覆盖环境变量) ---
    const finalAk = flags.ak ?? Deno.env.get("MEMOBIRD_AK");
    const finalDid = flags.did ?? Deno.env.get("MEMOBIRD_DEVICE_ID");

    if (!finalAk) {
        console.error("Error: Memobird AK not provided via --ak argument or MEMOBIRD_AK environment variable.");
        printHelp();
        Deno.exit(1);
    }
    if (!finalDid) {
        console.error("Error: Memobird Device ID not provided via --did argument or MEMOBIRD_DEVICE_ID environment variable.");
        printHelp();
        Deno.exit(1);
    }

    // --- 初始化 Memobird 客户端 ---
    try {
        // 使用静态工厂方法异步创建实例
        bird = await MemobirdDevice.create(finalAk, finalDid);
        console.log("MemobirdDevice client initialized successfully.");
    } catch (e) {
        if (e instanceof MemobirdError) {
            console.error(`Error initializing MemobirdDevice client: ${e.message}`);
        } else {
            console.error(`Unexpected error initializing Memobird client: ${e instanceof Error ? e.message : String(e)}`);
        }
        Deno.exit(1);
    }

    // --- 创建 MCP 服务器实例 ---
    const server = new McpServer({
        name: SERVER_NAME,
        version: "1.0.0" // 或从项目配置读取
    });
    console.log(`MCP Server '${SERVER_NAME}' created.`);

    // --- 定义 MCP 工具 ---

    // print_text 工具
    server.tool(
        "print_text",
        { text: z.string().describe("The text content to print.") }, // 添加描述
        async ({ text }) => {
            console.log(`Received print_text request: '${text.substring(0, 50)}...'`);
            if (!bird) {
                return { isError: true, content: [{ type: "text", text: "Error: Memobird client not initialized." }] };
            }
            try {
                const contentId = await bird.printText(text);
                const result = `Text sent to printer successfully. Content ID: ${contentId}`;
                console.log(result);
                return { content: [{ type: "text", text: result }] };
            } catch (e) {
                let errorMsg = `Unexpected error printing text: ${e instanceof Error ? e.message : String(e)}`;
                if (e instanceof ApiError) {
                    errorMsg = `Error printing text (API/Network): ${e.message}`;
                } else if (e instanceof NetworkError) {
                    errorMsg = `Error printing text (Network): ${e.message}`;
                } else if (e instanceof MemobirdError) {
                    errorMsg = `Memobird client error printing text: ${e.message}`;
                }
                console.error(errorMsg);
                return { isError: true, content: [{ type: "text", text: errorMsg }] };
            }
        }
    );

    // print_image 工具
    server.tool(
        "print_image",
        // Base64 编码的图像数据字符串
        { image_base64: z.string().describe("Base64-encoded image data string.") },
        async ({ image_base64 }) => {
            console.log(`Received print_image request (base64 data length: ${image_base64.length})`);
            if (!bird) {
                return { isError: true, content: [{ type: "text", text: "Error: Memobird client not initialized." }] };
            }
            // **重要:** 当前实现不处理文件路径或图像转换。
            // 它期望输入是已经是 Memobird 可接受格式（可能是 1 位 BMP）的 Base64 编码数据。
            // 未来可能需要添加图像处理库来支持文件路径和转换。
            try {
                const contentId = await bird.printImage(image_base64);
                const result = `Base64 image sent to printer successfully. Content ID: ${contentId}`;
                console.log(result);
                return { content: [{ type: "text", text: result }] };
            } catch (e) {
                let errorMsg = `Unexpected error printing image: ${e instanceof Error ? e.message : String(e)}`;
                if (e instanceof ContentError) {
                    errorMsg = `Error processing image data: ${e.message}`;
                } else if (e instanceof ApiError) {
                    errorMsg = `Error printing image (API/Network): ${e.message}`;
                } else if (e instanceof NetworkError) {
                    errorMsg = `Error printing image (Network): ${e.message}`;
                } else if (e instanceof MemobirdError) {
                    errorMsg = `Memobird client error printing image: ${e.message}`;
                }
                console.error(errorMsg);
                return { isError: true, content: [{ type: "text", text: errorMsg }] };
            }
        }
    );

    // print_url 工具
    server.tool(
        "print_url",
        { url: z.string().url().describe("The URL of the content to print.") },
        async ({ url }) => {
            console.log(`Received print_url request for URL: ${url}`);
            if (!bird) {
                return { isError: true, content: [{ type: "text", text: "Error: Memobird client not initialized." }] };
            }
            try {
                const contentId = await bird.printUrl(url);
                const result = `URL content sent to printer successfully. Content ID: ${contentId}`;
                console.log(result);
                return { content: [{ type: "text", text: result }] };
            } catch (e) {
                let errorMsg = `Unexpected error printing URL ${url}: ${e instanceof Error ? e.message : String(e)}`;
                if (e instanceof ApiError) {
                    errorMsg = `Error printing URL (API/Network): ${e.message}`;
                } else if (e instanceof NetworkError) {
                    errorMsg = `Error printing URL (Network): ${e.message}`;
                } else if (e instanceof MemobirdError) {
                    errorMsg = `Memobird client error printing URL: ${e.message}`;
                }
                console.error(errorMsg);
                return { isError: true, content: [{ type: "text", text: errorMsg }] };
            }
        }
    );


    // --- 启动服务器 ---
    const transportType = flags.transport.toLowerCase();

    if (transportType === "stdio") {
        console.log("Starting server with stdio transport...");
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.log("Server finished.");
    } else if (transportType === "sse") {
        const port = parseInt(flags.port, 10);
        if (isNaN(port)) {
            console.error(`Error: Invalid port number '${flags.port}'.`);
            Deno.exit(1);
        }

        console.log(`Starting server with SSE transport on port ${port}...`);

        // 使用对象来存储不同会话的 transport
        const transports: { [sessionId: string]: SSEServerTransport } = {};

        // 创建 HTTP 服务器，使用标准 Node.js HTTP API (Deno 兼容)
        const httpServer = http.createServer((req, res) => {
            const url = new URL(req.url || "", `http://${req.headers.host}`);
            console.log(`${req.method} ${url.pathname}`);

            if (url.pathname === "/") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    message: `Welcome to the ${SERVER_NAME} MCP Server`,
                    endpoints: {
                        "/": "This information page",
                        "/sse": "SSE connection endpoint",
                        "/messages": "Message handling endpoint (requires sessionId)"
                    }
                }));
                return;
            }

            // 处理 SSE 连接请求
            if (req.method === "GET" && url.pathname === "/sse") {
                console.log("SSE connection attempt received");

                // 设置 SSE 响应头
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "Access-Control-Allow-Origin": "*"
                });

                // 创建 SSEServerTransport，直接使用 res 响应对象
                const transport = new SSEServerTransport("/messages", res);
                const sessionId = transport.sessionId;
                transports[sessionId] = transport;

                console.log(`SSE transport created with sessionId: ${sessionId}`);

                // 监听连接关闭
                res.on("close", () => {
                    console.log(`SSE connection closed for session: ${sessionId}`);
                    delete transports[sessionId];
                });

                // 连接到 MCP 服务器
                server.connect(transport).then(() => {
                    console.log(`MCP Server connected to transport for session: ${sessionId}`);
                }).catch(e => {
                    console.error(`Error connecting server to transport: ${e instanceof Error ? e.message : String(e)}`);
                });

                return;
            }

            // 处理消息请求
            if (req.method === "POST" && url.pathname === "/messages") {
                const sessionId = url.searchParams.get("sessionId");
                if (!sessionId) {
                    res.writeHead(400);
                    res.end("Missing sessionId query parameter");
                    return;
                }

                console.log(`Received message for sessionId: ${sessionId}`);

                const transport = transports[sessionId];
                if (!transport) {
                    console.warn(`No active SSE transport found for sessionId: ${sessionId}`);
                    res.writeHead(400);
                    res.end(`No transport found for sessionId ${sessionId}`);
                    return;
                }

                console.log(`Handling message with transport for session: ${sessionId}`);

                // 直接调用 transport 的处理方法
                transport.handlePostMessage(req, res).catch(e => {
                    console.error(`Error handling POST message: ${e instanceof Error ? e.message : String(e)}`);
                    if (!res.writableEnded) {
                        res.writeHead(500);
                        res.end(`Internal Server Error: ${e instanceof Error ? e.message : "Unknown error"}`);
                    }
                });

                return;
            }

            // 未找到请求的路径
            res.writeHead(404);
            res.end("Not Found");
        });

        // 启动 HTTP 服务器
        httpServer.listen(port, () => {
            console.log(`HTTP SSE server listening on http://localhost:${port}`);
        });

        // 保持进程运行，直到收到中断信号
        await new Promise<void>((resolve) => {
            Deno.addSignalListener("SIGINT", () => {
                console.log("Received SIGINT, shutting down...");
                httpServer.close(() => {
                    console.log("Server closed");
                    resolve();
                });
            });
        });
    } else {
        console.error(`Error: Invalid transport type '${flags.transport}'. Use 'stdio' or 'sse'.`);
        printHelp();
        Deno.exit(1);
    }
}

// --- 入口点 ---
if (import.meta.main) {
    await main();
}