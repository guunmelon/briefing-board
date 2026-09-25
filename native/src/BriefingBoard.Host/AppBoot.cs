using System.Threading;
using System.Windows;

namespace BriefingBoard.Host;

/// <summary>프로그래매틱 WPF 진입점(App.xaml 없이).</summary>
public static class AppBoot
{
    [STAThread]
    public static void Main(string[] args)
    {
        var devTools = args.Contains("--devtools");

        // 진단 모드: WebView2 없이 로컬 서버·웹 파일·API 를 검사 (결과 파일 + 창)
        if (args.Contains("--selftest"))
        {
            SelfTest.Run();
            return;
        }

        // 브라우저 모드: WebView2 없이 기본 브라우저로 표시 (고장난 WebView2 회피 폴백)
        if (args.Contains("--browser"))
        {
            BrowserMode.Run();
            return;
        }

        // 단일 인스턴스
        using var mutex = new Mutex(true, @"Local\BriefingBoard_Native_v1", out var createdNew);
        if (!createdNew)
        {
            System.Windows.MessageBox.Show("BriefingBoard 가 이미 실행 중입니다.\n시스템 트레이 아이콘을 확인하세요.",
                "BriefingBoard", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var prefs = Preferences.LoadAsync().GetAwaiter().GetResult();
        var app = new System.Windows.Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };

        // 진단: UI 스레드에서 잡히지 않은 예외를 로그로 남기고(기본 동작 유지)
        app.DispatcherUnhandledException += (_, e) =>
        {
            AppLog.Write($"UI 예외: {e.Exception}");
        };
        System.Threading.Tasks.TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            AppLog.Write($"백그라운드 예외: {e.Exception}");
            e.SetObserved();
        };

        var window = new MainWindow(prefs, devTools);
        app.Run(window);
    }
}
