# Memobird Printer Server (Deno)

[![Deno](https://img.shields.io/badge/deno-%5E1.x-brightgreen.svg?logo=deno)](https://deno.land/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

这是一个使用 [Deno](https://deno.land/) 编写的 [Model Context Protocol (MCP)](https://docs.modelcontext.dev/) 服务器，用于通过其 API 控制 [Memobird](http://www.memobird.cn/) 咕咕机。

它提供了通过 MCP 工具发送文本、图像 (Base64 编码) 和 URL 到 Memobird 打印机的功能。

## 特性

*   **MCP 集成**: 作为 MCP 服务器运行，允许兼容的客户端 (如 Cline) 连接和使用其工具。
*   **多种传输方式**: 支持 `stdio` (标准输入/输出) 和 `sse` (Server-Sent Events over HTTP) 两种传输协议。
*   **灵活配置**: 可以通过命令行参数或环境变量配置 Memobird API 凭据。
*   **基本打印功能**: 提供打印文本、Base64 编码图像和 URL 内容的工具。

## 安装

1.  **安装 Deno**:
    确保您的系统上安装了 Deno (版本 1.x 或更高)。请参考官方 [Deno 安装指南](https://docs.deno.com/runtime/manual/getting_started/installation)。

2.  **克隆仓库 (如果适用)**:
    如果您是从 Git 仓库获取代码，请克隆它：
    ```bash
    git clone <your-repo-url>
    cd mcp-memobird.deno
    ```

3.  **依赖**:
    Deno 会在首次运行时自动下载和缓存依赖项。主要依赖包括：
    *   `@modelcontextprotocol/sdk`: 用于实现 MCP 服务器。
    *   `zod`: 用于输入验证。
    *   `@std/cli`: 用于解析命令行参数。

## 配置

您需要提供 Memobird API 的 Access Key (AK) 和设备 ID (Device ID)。可以通过以下两种方式配置：

1.  **环境变量 (推荐)**:
    ```bash
    export MEMOBIRD_AK="YOUR_ACCESS_KEY"
    export MEMOBIRD_DEVICE_ID="YOUR_DEVICE_ID"
    ```
    (在 Windows PowerShell 中使用 `$env:MEMOBIRD_AK = "YOUR_ACCESS_KEY"`)

2.  **命令行参数**:
    在运行命令时添加 `--ak` 和 `--did` 参数：
    ```bash
    deno task start --ak YOUR_ACCESS_KEY --did YOUR_DEVICE_ID
    ```
    *注意：命令行参数会覆盖环境变量。*

## 运行服务器

项目提供了 `deno.jsonc` 文件来管理任务。

*   **使用 Stdio 传输**:
    这是默认模式，适用于 Cline 等通过标准输入/输出连接的客户端。
    ```bash
    deno task start
    # 或者带凭据:
    # deno task start --ak YOUR_ACCESS_KEY --did YOUR_DEVICE_ID
    ```

*   **使用 SSE 传输**:
    这将启动一个 HTTP 服务器，允许客户端通过 Server-Sent Events 连接。默认端口为 `8001`。
    ```bash
    deno task start:sse
    # 指定不同端口:
    # deno task start:sse --port 8002
    # 带凭据:
    # deno task start:sse --ak YOUR_ACCESS_KEY --did YOUR_DEVICE_ID
    ```
    服务器将在 `http://localhost:<port>` 上监听。SSE 端点是 `http://localhost:<port>/sse`。

*   **开发模式 (使用 Stdio)**:
    此模式下，文件更改时服务器会自动重启。
    ```bash
    deno task dev
    ```

## MCP 工具

服务器提供以下 MCP 工具供客户端调用：

1.  **`print_text`**
    *   **描述**: 发送纯文本内容到 Memobird 打印机。
    *   **参数**:
        *   `text` (string, required): 要打印的文本内容。
    *   **示例 (假设使用 Cline)**:
        ```
        /use Memobird Printer Server (Deno).print_text text="Hello from Deno MCP!"
        ```

2.  **`print_image`**
    *   **描述**: 发送 Base64 编码的图像数据到 Memobird 打印机。
    *   **重要**: 当前实现期望输入是已经是 Memobird 可接受格式 (通常是 1 位 BMP) 的 Base64 编码数据。它**不**执行图像格式转换或从文件路径加载。
    *   **参数**:
        *   `image_base64` (string, required): Base64 编码的图像数据字符串。
    *   **示例**:
        ```
        /use Memobird Printer Server (Deno).print_image image_base64="data:image/bmp;base64,Qk0..."
        ```

3.  **`print_url`**
    *   **描述**: 指示 Memobird 服务器从指定的 URL 获取内容并打印。
    *   **参数**:
        *   `url` (string, required): 要打印内容的 URL。必须是有效的 URL。
    *   **示例**:
        ```
        /use Memobird Printer Server (Deno).print_url url="https://example.com/printable_content.html"
        ```

## 许可证

本项目采用 [MIT 许可证](LICENSE)。# mcp-memobird.deno
