using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Windows;
using WpfMsg = System.Windows.MessageBox;

namespace BriefingBoard.Host;

/// <summary>
/// WebView2 없이 셸 문제인지 로컬 서버/웹 파일 문제인지 가르는 셀프테스트.
/// 실행: BriefingBoard.exe --selftest
///   → NativeServer 기동 후 /(정적 UI)와 /api/health 를 실제 HTTP 로 요청
///   → 결과를 %LOCALAPPDATA%\BriefingBoard\selftest.txt 로 저장 + 창으로 표시
/// </summary>
public static class SelfTest
{
    public static void Run()
    {
        var lines = new List<string>();
        void Say(string s) => lines.Add(s);

        Say($"BriefingBoard 셀프테스트 — {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
        Say("");

        try
        {
            var prefs = Preferences.LoadAsync().GetAwaiter().GetResult();
            var webPath = AppPaths.WebIndexPath;
            long size = -1;
            if (webPath is null)
            {
                Say("[X] web/index.html 을 찾지 못함");
                Say($"    AppContext.BaseDirectory = {AppContext.BaseDirectory}");
            }
            else
            {
                size = new FileInfo(webPath).Length;
                Say(size > 50_000
                    ? $"[OK] web/index.html 존재 · {size:N0}바이트"
                    : $"[!!] web/index.html 크기 이상함 · {size:N0}바이트 (정상은 200KB 이상)");
            }

            var webDir = webPath is null ? AppContext.BaseDirectory : Path.GetDirectoryName(webPath)!;
            var srv = new NativeServer(webDir, prefs, secretReader: () => null);
            srv.Start();
            var url = $"http://127.0.0.1:{srv.Port}";
            Say($"[OK] 로컬 서버 시작 → 포트 {srv.Port}");

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            try
            {
                var sw = Stopwatch.StartNew();
                using var r = http.GetAsync(url + "/").GetAwaiter().GetResult();
                var body = r.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
                sw.Stop();
                Say(body.Length > 50_000
                    ? $"[OK] GET / → HTTP {(int)r.StatusCode} · {body.Length:N0}바이트 · {sw.ElapsedMilliseconds}ms  (브라우저에 보일 페이지 정상)"
                    : $"[!!] GET / → HTTP {(int)r.StatusCode} · {body.Length:N0}바이트 (비정상)");
            }
            catch (Exception ex) { Say($"[X] GET / 실패: {ex.Message}"); }

            try
            {
                var h = http.GetStringAsync(url + "/api/health").GetAwaiter().GetResult();
                Say(h.Contains("\"native\":true", StringComparison.Ordinal) || h.Contains("\"native\": true")
                    ? "[OK] GET /api/health → 서버 API 정상"
                    : $"[!!] GET /api/health 응답 이상: {h[..Math.Min(200, h.Length)]}");
            }
            catch (Exception ex) { Say($"[X] GET /api/health 실패: {ex.Message}"); }

            srv.Dispose();

            Say("");
            Say("판정:");
            Say("  이 항목이 모두 정상인데도 앱 화면이 흰색/로딩이면 → 문제는 이 PC의 WebView2 쪽.");
            Say("  조치: %LOCALAPPDATA%\\BriefingBoard\\WebView2 삭제 후 재실행, 안 되면 WebView2 런타임 재설치");
            Say("        https://developer.microsoft.com/microsoft-edge/webview2/");
        }
        catch (Exception ex)
        {
            Say($"[X] 셀프테스트 예외: {ex}");
        }

        lines.Add("");
        lines.Add("결과 저장: %LOCALAPPDATA%\\BriefingBoard\\selftest.txt");
        var text = string.Join(Environment.NewLine, lines) + Environment.NewLine;
        try
        {
            File.WriteAllText(Path.Combine(AppPaths.RootDir, "selftest.txt"), text);
        }
        catch { /* 화면 표시로 충분 */ }

        WpfMsg.Show(text, "BriefingBoard 셀프테스트",
            MessageBoxButton.OK, text.Contains("[X]") || text.Contains("[!!]") ? MessageBoxImage.Warning : MessageBoxImage.Information);
    }
}
