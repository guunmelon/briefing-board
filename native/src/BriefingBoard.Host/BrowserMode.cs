using System.Diagnostics;
using System.IO;

namespace BriefingBoard.Host;

/// <summary>
/// 브라우저 모드 — WebView2 를 쓰지 않는 폴백 실행.
/// NativeServer 를 띄우고 기본 브라우저로 보드 화면을 연다(사용자가 web/index.html 을
/// 브라우저에서 정상 확인한 경우 즉시 사용 가능). 트레이의 '종료'로 서버를 끝낸다.
/// 실행: BriefingBoard.exe --browser
/// </summary>
public static class BrowserMode
{
    public static void Run()
    {
        var done = new ManualResetEventSlim(false);
        try
        {
            var prefs = Preferences.LoadAsync().GetAwaiter().GetResult();
            var webPath = AppPaths.WebIndexPath;
            if (webPath is null || !File.Exists(webPath))
            {
                System.Windows.Forms.MessageBox.Show(
                    "web/index.html 을 찾지 못했습니다.\nexe 옆에 web 폴더가 함께 있어야 합니다.",
                    "BriefingBoard 브라우저 모드",
                    System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Warning);
                return;
            }

            var webDir = Path.GetDirectoryName(webPath)!;
            var server = new NativeServer(webDir, prefs, secretReader: () => CredentialSafe.ReadPassword());
            server.Start();
            // ?host=1 을 붙여 host.js(라이브 /api)를 활성화 → 데모가 아닌 실제 iCloud·RSS 데이터를 보여준다
            var url = $"http://127.0.0.1:{server.Port}/?host=1";
            AppLog.Write("BROWSER 모드 시작 → " + url);

            using var tray = new TrayHost(TrayHost.MakeIcon());
            tray.ToggleRequested += () => OpenUrl(url);              // 보드 열기 = 브라우저 다시 열기
            tray.RefreshNewsRequested += () =>
            {
                _ = Task.Run(async () =>
                {
                    try { await server.EnsureNewsAsync(true, CancellationToken.None); }
                    catch { }
                });
                OpenUrl(url);
            };
            tray.BalloonTestRequested += () =>
            {
                tray.ShowBalloon("새 브리핑 도착", "새 소식 2건이 들어왔어요. (테스트)");
                tray.ShowBalloon("다가오는 일정", "15분 뒤 '주간 회의'가 시작돼요. (테스트)");
            };
            tray.ExitRequested += () => done.Set();
            tray.Start();

            AppLog.Write("BROWSER 브라우저 열기 → " + url);
            OpenUrl(url);

            System.Windows.Forms.MessageBox.Show(
                "브라우저 모드로 실행 중입니다.\n\n" +
                "기본 브라우저에 보드가 열렸습니다(없으면 주소창에 아래를 입력하세요).\n" +
                url + "\n\n" +
                "이 앱(트레이 아이콘)이 로컬 서버 역할을 하므로, 종료할 때까지 유지하세요.\n\n" +
                "종료: 트레이 아이콘 우클릭 → '종료'",
                "BriefingBoard 브라우저 모드",
                System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Information);

            done.Wait();   // 트레이 '종료'까지 유지
            server.Dispose();
            AppLog.Write("BROWSER 모드 종료");
        }
        catch (Exception ex)
        {
            AppLog.Write("BROWSER 모드 예외: " + ex);
            try
            {
                System.Windows.MessageBox.Show("브라우저 모드 실행 실패:\n" + ex.Message,
                    "BriefingBoard", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Error);
            }
            catch { }
        }
    }

    private static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true }); }
        catch (Exception ex) { AppLog.Write("BROWSER 열기 실패: " + ex.Message); }
    }
}
