using System.IO;
namespace BriefingBoard.Host;

/// <summary>
/// 로컬 데이터 서버용 미니멀 HTTP 구현(HttpListener 의 URL ACL 이슈 회피 — 관리자 권한 불필요).
/// 127.0.0.1 동적 포트에 바인딩하고 단일 호스트에게만 서빙한다.
/// </summary>
public sealed class HttpMini : IDisposable
{
    private readonly System.Net.Sockets.TcpListener _listener;
    private readonly Func<HttpCtx, Task> _handler;
    private readonly CancellationTokenSource _cts = new();
    private bool _started;

    public int Port { get; }

    public HttpMini(Func<HttpCtx, Task> handler)
    {
        _handler = handler;
        _listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((System.Net.IPEndPoint)_listener.LocalEndpoint).Port;
    }

    public void Start()
    {
        if (_started) return;
        _started = true;
        _ = Task.Run(AcceptLoopAsync);
    }

    private async Task AcceptLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            System.Net.Sockets.TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(_cts.Token); }
            catch { break; }
            _ = Task.Run(() => ServeAsync(client));
        }
    }

    private async Task ServeAsync(System.Net.Sockets.TcpClient client)
    {
        using (client)
        using (var ns = client.GetStream())
        {
            try
            {
                ns.ReadTimeout = 20_000;
                var head = new byte[24 * 1024];
                var have = 0;
                int headEnd = -1;
                while (true)
                {
                    int n = await ns.ReadAsync(head.AsMemory(have, head.Length - have), _cts.Token);
                    if (n <= 0) throw new EndOfStreamException("연결 종료");
                    have += n;
                    headEnd = FindHeaderEnd(head, have);
                    if (headEnd >= 0) break;
                    if (have >= head.Length) throw new InvalidDataException("헤더 과대");
                }

                var headText = System.Text.Encoding.UTF8.GetString(head, 0, headEnd);
                var request = ParseHead(headText);
                if (request is null) return;

                // 본문 — 남은 버퍼 + 스트림. Content-Length 또는 chunked(Transfer-Encoding) 지원
                int bodyStart = headEnd + 4;
                int leftover = have - bodyStart;
                byte[] body;
                if (request.Chunked)
                {
                    body = await ReadChunkedAsync(ns, head, bodyStart, leftover, _cts.Token);
                }
                else
                {
                    int cl = request.ContentLength;
                    body = new byte[cl];
                    int copied = Math.Min(cl, leftover);
                    if (copied > 0) Buffer.BlockCopy(head, bodyStart, body, 0, copied);
                    int done = copied;
                    while (done < cl)
                    {
                        int n = await ns.ReadAsync(body.AsMemory(done, cl - done), _cts.Token);
                        if (n <= 0) throw new EndOfStreamException("본문 중단");
                        done += n;
                    }
                }
                request.Body = body;

                var ctx = new HttpCtx(request.Method, request.Path, request.Query, request.Headers, request.Body, ns);
                try
                {
                    await _handler(ctx);
                }
                catch (Exception ex)
                {
                    try { await ctx.WriteTextAsync(500, "text/plain; charset=utf-8", "서버 오류: " + ex.Message); }
                    catch { /* 소켓 닫힘 */ }
                }
            }
            catch
            {
                /* 개별 요청 실패는 무시 (로컬 도구 특성) */
            }
        }
    }

    private static int FindHeaderEnd(byte[] buf, int len)
    {
        for (int i = 0; i + 3 < len; i++)
            if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10)
                return i;
        return -1;
    }

    private sealed record RequestHead(string Method, string Path, string Query,
        Dictionary<string, string> Headers, int ContentLength, bool Chunked)
    {
        public byte[] Body = Array.Empty<byte>();
    }

    /// <summary>chunked 본문 디코딩(헤더 이후 잔여 바이트 포함). 경량 로컬 서버용.</summary>
    private static async Task<byte[]> ReadChunkedAsync(
        System.IO.Stream ns, byte[] leftoverBuf, int start, int leftover, System.Threading.CancellationToken ct)
    {
        var carry = new byte[Math.Max(8192, leftover)];
        int cnt = 0;
        if (leftover > 0)
        {
            Buffer.BlockCopy(leftoverBuf, start, carry, 0, leftover);
            cnt = leftover;
        }

        void EnsureCapacity(int need) // 버퍼 공간 확보 (가득 차면 두 배)
        {
            if (need <= carry.Length) return;
            var grown = new byte[Math.Max(carry.Length * 2, need)];
            Buffer.BlockCopy(carry, 0, grown, 0, cnt);
            carry = grown;
        }

        async Task ReadMoreAsync()
        {
            EnsureCapacity(cnt + 4096);
            int n = await ns.ReadAsync(carry.AsMemory(cnt, carry.Length - cnt), ct);
            if (n <= 0) throw new EndOfStreamException("chunk 중단");
            cnt += n;
        }

        var sink = new MemoryStream();
        while (true)
        {
            // chunk 크기 라인 — CRLF 까지
            int lineEnd;
            while (true)
            {
                lineEnd = -1;
                for (int i = 0; i + 1 < cnt; i++)
                    if (carry[i] == 13 && carry[i + 1] == 10) { lineEnd = i; break; }
                if (lineEnd >= 0) break;
                EnsureCapacity(cnt + 1);
                await ReadMoreAsync();
            }

            var sizeLine = System.Text.Encoding.ASCII.GetString(carry, 0, lineEnd);
            int semi = sizeLine.IndexOf(';');
            if (semi >= 0) sizeLine = sizeLine[..semi];
            int size = Convert.ToInt32(sizeLine.Trim(), 16);
            int dataStart = lineEnd + 2;

            if (size == 0) break; // 트레일러는 무시(로컬 클라이언트는 안 씀)

            // 데이터 size 바이트 + 끝 CRLF 확보
            while (cnt - dataStart < size + 2)
            {
                EnsureCapacity(cnt + 4096);
                await ReadMoreAsync();
            }

            sink.Write(carry, dataStart, size);
            int next = dataStart + size + 2;
            Buffer.BlockCopy(carry, next, carry, 0, cnt - next); // 남은 바이트 앞으로
            cnt -= next;
        }
        return sink.ToArray();
    }

    private static RequestHead? ParseHead(string text)
    {
        var lines = text.Split('\n');
        if (lines.Length < 2) return null;
        var reqLine = lines[0].TrimEnd('\r');
        var parts = reqLine.Split(' ', 3, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return null;
        var method = parts[0].ToUpperInvariant();
        var rawPath = parts[1];
        int q = rawPath.IndexOf('?');
        var path = q >= 0 ? rawPath[..q] : rawPath;
        var query = q >= 0 ? rawPath[(q + 1)..] : "";

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        int cl = 0;
        bool chunked = false;
        for (int i = 1; i < lines.Length; i++)
        {
            var line = lines[i].TrimEnd('\r');
            if (line.Length == 0) continue;
            int c = line.IndexOf(':');
            if (c <= 0) continue;
            var key = line[..c].Trim();
            var val = line[(c + 1)..].Trim();
            headers[key] = val;
            if (key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) && int.TryParse(val, out var n) && n > 0)
                cl = Math.Min(n, 8 * 1024 * 1024);
            else if (key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase) &&
                     val.Contains("chunked", StringComparison.OrdinalIgnoreCase))
                chunked = true;
        }
        if (chunked) cl = 0;
        return new RequestHead(method, path, Uri.UnescapeDataString(query.Replace("+", " ")), headers, cl, chunked);
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _listener.Stop(); } catch { }
    }
}

/// <summary>요청 컨텍스트 — 라우터에서 읽고 응답을 쓴다.</summary>
public sealed class HttpCtx
{
    public string Method { get; }
    public string Path { get; }
    public string Query { get; }
    public IReadOnlyDictionary<string, string> Headers { get; }
    public byte[] Body { get; }
    private readonly System.IO.Stream _out;

    public HttpCtx(string method, string path, string query,
        IReadOnlyDictionary<string, string> headers, byte[] body, System.IO.Stream output)
    {
        Method = method;
        Path = path;
        Query = query;
        Headers = headers;
        Body = body;
        _out = output;
    }

    private static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        ["html"] = "text/html; charset=utf-8",
        ["htm"] = "text/html; charset=utf-8",
        ["css"] = "text/css; charset=utf-8",
        ["js"] = "application/javascript; charset=utf-8",
        ["mjs"] = "application/javascript; charset=utf-8",
        ["json"] = "application/json; charset=utf-8",
        ["svg"] = "image/svg+xml",
        ["png"] = "image/png",
        ["jpg"] = "image/jpeg",
        ["jpeg"] = "image/jpeg",
        ["webp"] = "image/webp",
        ["gif"] = "image/gif",
        ["ico"] = "image/x-icon",
        ["woff2"] = "font/woff2",
        ["ttf"] = "font/ttf",
        ["otf"] = "font/otf",
        ["mp3"] = "audio/mpeg",
        ["wav"] = "audio/wav",
        ["txt"] = "text/plain; charset=utf-8",
        ["map"] = "application/json",
    };

    public static string ContentTypeFor(string path)
    {
        var ext = System.IO.Path.GetExtension(path).TrimStart('.');
        return Mime.TryGetValue(ext, out var m) ? m : "application/octet-stream";
    }

    public async Task WriteAsync(int status, string contentType, byte[] body,
        string extraHeaders = "", bool noCache = false)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(StatusText(status)).Append("\r\n");
        sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
        sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
        sb.Append("Connection: close\r\n");
        sb.Append("Access-Control-Allow-Origin: *\r\n");
        sb.Append(noCache ? "Cache-Control: no-store\r\n" : "Cache-Control: no-cache\r\n");
        if (extraHeaders.Length > 0) sb.Append(extraHeaders).Append("\r\n");
        sb.Append("\r\n");
        var headBytes = System.Text.Encoding.UTF8.GetBytes(sb.ToString());
        await _out.WriteAsync(headBytes);
        await _out.WriteAsync(body);
        await _out.FlushAsync();
    }

    public Task WriteTextAsync(int status, string contentType, string text, bool noCache = true)
        => WriteAsync(status, contentType, System.Text.Encoding.UTF8.GetBytes(text), noCache: noCache);

    public Task WriteJsonAsync(int status, string json)
        => WriteAsync(status, "application/json; charset=utf-8", System.Text.Encoding.UTF8.GetBytes(json));

    public Task WriteBytesAsync(byte[] body, string contentType, bool noCache = false)
        => WriteAsync(200, contentType, body, noCache: noCache);

    private static string StatusText(int s) => s switch
    {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "Status",
    };
}
