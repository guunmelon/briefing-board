using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using BriefingBoard.Core.Models;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Drawing = System.Drawing;
using MediaColor = System.Windows.Media.Color;
using SolidColorBrush = System.Windows.Media.SolidColorBrush;

namespace BriefingBoard.Host;

/// <summary>
/// 보드 메인 창 — 항상 위 가능한 투명 없는 WebView2 셸.
///  - 로컬 NativeServer 가 뉴스/일정 API + 정적 UI 를 제공
///  - 시스템 트레이(열기/숨기기/새로고침/항상 위/종료)
///  - 렌더러는 선택적으로 window.__BRIEFING_HOST__ 와 chrome.webview.postMessage 로 확장
/// </summary>
public sealed class MainWindow : Window
{
    private const string AccentHex = "#58A6FF";

    private readonly Preferences _prefs;
    private readonly bool _devTools;
    private readonly WebView2 _web = new();
    private readonly Grid _root = new();
    private NativeServer? _server;
    private TrayHost? _trayHost;
    private bool _forceQuit;
    private bool _webReady;
    private TextBlock? _fatal;

    public MainWindow(Preferences prefs, bool devTools)
    {
        _prefs = prefs;
        _devTools = devTools;

        Title = "BriefingBoard";
        Background = new SolidColorBrush(MediaColor.FromRgb(13, 17, 23));
        Width = _prefs.Width;
        Height = _prefs.Height;
        if (_prefs.Left is double px && _prefs.Top is double py)
        {
            Left = Math.Clamp(px, -2000, 4000);
            Top = Math.Clamp(py, -2000, 4000);
        }
        else
        {
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }
        Topmost = _prefs.Topmost;
        MinWidth = 460;
        MinHeight = 360;

        _web.DefaultBackgroundColor = Drawing.Color.FromArgb(13, 17, 23); // WebView2 기본 배경(시작 플리커 방지)
        _web.VerticalAlignment = System.Windows.VerticalAlignment.Stretch;
        _web.HorizontalAlignment = System.Windows.HorizontalAlignment.Stretch;
        _root.Children.Add(_web);
        Content = _root;

        Closing += OnClosing;
        Loaded += async (_, _) => await InitializeAsync();

        // 트레이를 창 생성 직후부터 띄운다 — 초기화가 오래 걸려도 종료/재시도가 가능하도록.
        // (InitializeAsync 가 다시 호출해도 CreateTray 는 멱등이라 중복 생성 안 됨)
        CreateTray();
    }

    // ============================= 초기화 =============================

    private async Task InitializeAsync()
    {
        AppLog.Write("BOOT 시작");
        try
        {
            StartServer();
            CreateTray();
            await EnsureWebAsync();
            AppLog.Write("BOOT 완료");
        }
        catch (Exception ex)
        {
            AppLog.Write($"BOOT 예외: {ex}");
            ShowFatal("WebView2 초기화 실패", ex);
        }
    }

    private void StartServer()
    {
        var webDir = AppPaths.WebIndexPath is { } path ? Path.GetDirectoryName(path)! : "";
        _server = new NativeServer(
            webDir,
            _prefs,
            secretReader: () => CredentialSafe.ReadPassword(),
            onPrefsChanged: () => Dispatcher.Invoke(ApplyPrefsUi));
        _server.Start();
        _server.NewsArrived += OnNewsArrived;
        _server.RemindersDue += OnRemindersDue;
        ApplyPrefsUi();   // 저장된 위치·항상위·자동 시작을 시작 시점에 동기화
    }

    // ============================= 알림(트레이 풍선) =============================

    private void OnNewsArrived(int fresh)
    {
        if (fresh <= 0) return;
        AppLog.Write($"EVENT 새 브리핑 {fresh}건 (알림 설정={_prefs.NotificationsEnabled})");
        if (!_prefs.NotificationsEnabled) return;
        _ = Dispatcher.InvokeAsync(() => ShowTrayBalloon("새 브리핑 도착",
            $"관심 주제의 새 소식이 {fresh}건 들어왔어요."));
    }

    private void OnRemindersDue(IReadOnlyList<CalEvent> due)
    {
        if (due is null || due.Count == 0) return;
        AppLog.Write($"EVENT 임박 일정 {due.Count}건 (알림 설정={_prefs.NotificationsEnabled})");
        if (!_prefs.NotificationsEnabled) return;
        _ = Dispatcher.InvokeAsync(() =>
        {
            var head = string.Join(" · ", due.Take(2).Select(e => e.Title));
            var tail = due.Count > 2 ? $" 외 {due.Count - 2}건" : "";
            ShowTrayBalloon("다가오는 일정", $"{head}{tail} — 시작 전이에요.");
        });
    }

    private void ShowTrayBalloon(string title, string text)
    {
        if (_trayHost is null) { AppLog.Write("BALLOON 생략 - 트레이 없음 (" + title + ")"); return; }
        _trayHost.ShowBalloon(title, text);
        AppLog.Write("BALLOON 표시 요청 -> '" + title + "' (트레이 스레드로 위임)");
    }

    /// <summary>스모크/수동 확인용 — 실제 알림과 동일한 풍선 경로로 두 종류를 순서대로 띄운다.</summary>
    private void TestBalloons()
    {
        AppLog.Write($"MENU 알림 테스트 요청 (NotificationsEnabled={_prefs.NotificationsEnabled})");
        if (_trayHost is null)
        {
            AppLog.Write("알림 테스트 중단 — 트레이 아이콘 없음");
            System.Windows.MessageBox.Show("트레이 아이콘이 아직 없어 알림을 띄울 수 없습니다. 잠시 후 다시 시도해 주세요.",
                "BriefingBoard", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        ShowTrayBalloon("새 브리핑 도착", "새 소식 2건이 들어왔어요. (테스트)");
        var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(2.5) };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            ShowTrayBalloon("다가오는 일정", "15분 뒤 '주간 회의'가 시작돼요. (테스트)");
            // 코드 실행 여부와 OS 차단 여부를 구분하기 위한 확인창
            System.Windows.MessageBox.Show(
                "알림 테스트 풍선 2종을 띄우는 코드는 정상 실행됐습니다.\n\n" +
                "화면(트레이 근처 또는 알림 센터)에 풍선이 안 보인다면:\n" +
                "  · Windows 설정 → 시스템 → 알림 → BriefingBoard 허용 + 배너 표시 켬\n" +
                "  · 집중 지원(방해 금지) 꺼짐 확인\n\n" +
                "자세한 로그: %LOCALAPPDATA%\\BriefingBoard\\app.log",
                "BriefingBoard 알림 테스트", MessageBoxButton.OK, MessageBoxImage.Information);
        };
        timer.Start();
    }

    private async Task EnsureWebAsync()
    {
        // 1) WebView2 환경(브라우저 프로세스) 생성 — 25초 타임아웃
        //    기본 GPU 가속을 꺼 흰 화면/렌더 프리즈(일부 GPU 드라이버·원격 데스크톱)를 회피한다.
        //    exe 옆 WebView2Runtime 폴더(=Fixed Version 추출본)가 있으면 시스템 WebView2 대신 그것을 사용.
        var envOpts = new CoreWebView2EnvironmentOptions
        {
            AdditionalBrowserArguments = _prefs.UseGpu ? "" : "--disable-gpu --disable-gpu-compositing",
        };
        var fixedVer = FixedWebView2Folder();
        AppLog.Write($"ENV 옵션: GPU={(_prefs.UseGpu ? "켬" : "끔(기본)")} · WebView2 출처={(fixedVer is null ? "시스템(Evergreen)" : "앱 내장(Fixed: " + fixedVer + ")")}");
        var envTask = CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: fixedVer,
            userDataFolder: AppPaths.WebView2DataDir,
            options: envOpts);
        if (await Task.WhenAny(envTask, Task.Delay(TimeSpan.FromSeconds(25))) != envTask)
        {
            AppLog.Write("WATCH WebView2 환경 생성 25초 초과 — 프로필 잠김 의심");
            ShowFatal("WebView2 초기화 지연",
                new TimeoutException("WebView2 환경 생성이 25초 안에 끝나지 않았습니다. 이전 실행 프로세스(msedgewebview2.exe)가 남아 프로필을 잠갔을 수 있습니다."));
            return;
        }
        var env = await envTask;   // 실패 시 예외 전파 → catch → ShowFatal

        // 2) 컨트롤 초기화 — 30초 타임아웃
        var initTask = _web.EnsureCoreWebView2Async(env);
        if (await Task.WhenAny(initTask, Task.Delay(TimeSpan.FromSeconds(30))) != initTask)
        {
            AppLog.Write("WATCH WebView2 컨트롤 초기화 30초 초과");
            ShowFatal("WebView2 초기화 지연",
                new TimeoutException("WebView2 컨트롤 초기화가 30초 안에 끝나지 않았습니다. %LOCALAPPDATA%\\BriefingBoard\\WebView2 를 삭제 후 재실행해 주세요."));
            return;
        }
        await initTask;
        if (_web.CoreWebView2 is null) throw new InvalidOperationException("CoreWebView2 생성 실패");

        var s = _web.CoreWebView2.Settings;
        s.AreDefaultContextMenusEnabled = false;
        s.AreDevToolsEnabled = _devTools;
        s.IsStatusBarEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = true; // Ctrl+R 등 유지
        s.IsZoomControlEnabled = true;

        _web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        _web.CoreWebView2.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (!string.IsNullOrEmpty(e.Uri)) OpenExternal(e.Uri);
        };

        _web.CoreWebView2.NavigationCompleted += OnNavigationCompleted;

        // 미래 확장용 호스트 프로브(UI 는 없어도 무해)
        var probe = $"window.__BRIEFING_HOST__=Object.freeze({{apiBase:'http://127.0.0.1:{_server!.Port}/',native:true,version:'0.1.0'}});true;";
        await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(probe);

        var uri = $"http://127.0.0.1:{_server.Port}/";
        _webUri = uri;
        AppLog.Write($"WEB 로드 시작 → {uri}  (web/index.html: {webIndexBytes()}바이트) · WebView2 런타임 버전: {webVer()}");
        _web.Source = new Uri(uri);
        _webReady = true;

        // 3) 첫 로드 워치독 — 10초 안에 NavigationCompleted 가 안 오면 재시도 → 끝내 안 오면 브라우저 열기 + 안내
        StartFirstNavWatchdog();
    }

    private async void StartFirstNavWatchdog()
    {
        try
        {
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                await Task.Delay(TimeSpan.FromSeconds(10));
                if (_navFirstOk) return;
                if (!_webReady || _web.CoreWebView2 is null) return;
                AppLog.Write($"WATCH 첫 로드 미완료 {attempt}회 — reload 시도");
                _web.CoreWebView2.Reload();
            }
            await Task.Delay(TimeSpan.FromSeconds(10));
            if (_navFirstOk) return;
            AppLog.Write("WATCH 첫 로드 3회 재시도 후에도 미완료");
            ShowFatal("페이지 로드 지연",
                new TimeoutException("보드 화면(WebView2)이 계속 로딩되지 않습니다.\n\n" +
                    "시스템 기본 브라우저로 같은 화면을 열어드립니다 — 거기서 정상 표시되면 앱의 WebView2 쪽 문제입니다.\n" +
                    "(기본 브라우저에 열린 주소가 이 앱 전용입니다. 이 창은 닫아도 됩니다.)\n\n" +
                    "조치: 1) 트레이 → 종료  2) %LOCALAPPDATA%\\BriefingBoard\\WebView2 삭제  3) 다시 실행"));
            OpenExternal(_webUri);
        }
        catch (Exception ex) { AppLog.Write($"WATCH 첫 로드 예외: {ex.Message}"); }
    }

    private long webIndexBytes()
    {
        try
        {
            var p = AppPaths.WebIndexPath;
            return p != null && File.Exists(p) ? new FileInfo(p).Length : -1;
        }
        catch { return -1; }
    }

    private string webVer()
    {
        try { return _web.CoreWebView2?.Environment?.BrowserVersionString ?? "?"; }
        catch { return "?"; }
    }

    /// <summary>exe 옆 WebView2Runtime 폴더에 Fixed Version 런타임이 있으면 그 경로 반환.</summary>
    private static string? FixedWebView2Folder()
    {
        try
        {
            var dir = Path.Combine(AppContext.BaseDirectory, "WebView2Runtime");
            return File.Exists(Path.Combine(dir, "msedgewebview2.exe")) ? dir : null;
        }
        catch { return null; }
    }

    // ---------- 탐색 완료: 실패 시 자동 재시도, 성공 후 빈 화면(흰색)이면 reload ----------

    private int _navFailures;
    private int _blankChecks;
    private bool _navFirstOk;
    private string _webUri = "";

    private async void OnNavigationCompleted(object? s, CoreWebView2NavigationCompletedEventArgs e)
    {
        try
        {
            AppLog.Write($"NAV ok={e.IsSuccess} status={e.HttpStatusCode} err={e.WebErrorStatus}");
            if (e.IsSuccess)
            {
                _navFailures = 0;
                _navFirstOk = true;
                await Task.Delay(4000);
                _ = CheckBlankAsync();
                return;
            }

            if (++_navFailures <= 3 && _webReady)
            {
                AppLog.Write($"NAV 실패 — {_navFailures}회 재시도");
                await Task.Delay(900 * _navFailures);
                if (_webReady) _web.CoreWebView2?.Reload();
            }
            else
            {
                AppLog.Write($"NAV 실패 반복 — 자동 복구 중단 (오류: {e.WebErrorStatus})");
            }
        }
        catch (Exception ex) { AppLog.Write($"NAV 핸들러 예외: {ex.Message}"); }
    }

    /// <summary>성공했는데 본문이 비어 있으면(흰 화면) 최대 2회까지 다시 로드.</summary>
    private async Task CheckBlankAsync()
    {
        try
        {
            if (!_webReady || _web.CoreWebView2 is null) return;
            var txt = await _web.CoreWebView2.ExecuteScriptAsync(
                "try{return String(document.body?document.body.innerText.length:0)}catch(e){return 'x'}");
            var len = int.TryParse(txt, out var n) ? n : -1;
            if (len == 0 && _blankChecks < 2)
            {
                _blankChecks++;
                AppLog.Write($"BLANK 본문 0자 감지(흰 화면) — {_blankChecks}회 reload");
                _web.CoreWebView2.Reload();
            }
        }
        catch (Exception ex) { AppLog.Write($"BLANK 체크 예외: {ex.Message}"); }
    }

    private void ShowFatal(string head, Exception ex)
    {
        if (_fatal is not null) return;
        var msg = ex is not null ? ex.Message : "";
        _fatal = new TextBlock
        {
            Text = $"{head}\n\n{msg}\n\nWebView2 런타임이 설치되어 있어야 합니다.\n(Windows 10/11 의 대부분은 기본 포함, Microsoft Edge WebView2 Runtime 기준)",
            Foreground = new SolidColorBrush(MediaColor.FromRgb(230, 237, 243)),
            Background = new SolidColorBrush(MediaColor.FromRgb(13, 17, 23)),
            FontSize = 14,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(28),
            VerticalAlignment = System.Windows.VerticalAlignment.Center,
        };
        _root.Children.Add(_fatal);
    }

    // ============================= 렌더러 ←→ 호스트 =============================

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var raw = e.TryGetWebMessageAsString();
        if (string.IsNullOrEmpty(raw)) return;
        var msg = Bridge.ReadIn(raw);
        if (msg is null || string.IsNullOrEmpty(msg.Type)) return;

        switch (msg.Type)
        {
            case "hide":
                Hide();
                break;
            case "minimize":
                WindowState = WindowState.Minimized;
                break;
            case "close":
                Hide();
                break;
            case "topmost":
            case "toggle-top":
                Topmost = !Topmost;
                _prefs.Topmost = Topmost;
                _ = _prefs.SaveAsync();
                break;
            case "refresh-news":
                _ = Task.Run(async () =>
                {
                    try { await (_server?.EnsureNewsAsync(true, CancellationToken.None) ?? Task.FromResult(new NewsSnapshot())); }
                    catch { /* UI 폴링에서 재시도 */ }
                });
                break;
            case "devtools":
                if (_webReady) _web.CoreWebView2?.OpenDevToolsWindow();
                break;
            case "open-external":
                if (!string.IsNullOrEmpty(msg.Url)) OpenExternal(msg.Url);
                break;
        }
    }

    private void ReplyToWeb(object payload)
    {
        if (!_webReady) return;
        try { _web.CoreWebView2?.PostWebMessageAsJson(Bridge.ToJson(payload)); }
        catch { /* 창 닫힘 사이 경쟁 */ }
    }

    public static void OpenExternal(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch { /* 무시 */ }
    }

    // ============================= 시스템 트레이 (전용 스레드) =============================

    private void CreateTray()
    {
        if (_trayHost is not null) return;

        var host = new TrayHost(TrayHost.MakeIcon());
        // 트레이 스레드 이벤트 → WPF UI 스레드로 마샬링
        host.ToggleRequested += () => Dispatcher.Invoke(ToggleBoard);
        host.ExitRequested += () => Dispatcher.Invoke(ExitApp);
        host.RefreshNewsRequested += () => Dispatcher.Invoke(RefreshNewsViaTray);
        host.BalloonTestRequested += () => Dispatcher.Invoke(TestBalloons);
        host.TopmostToggleRequested += () => Dispatcher.Invoke(ToggleTopmost);
        host.Start();
        host.SetTopmostChecked(Topmost);
        _trayHost = host;
        AppLog.Write("TRAY 전용 스레드 시작");
    }

    private void RefreshNewsViaTray()
    {
        _ = Task.Run(async () =>
        {
            try { await (_server?.EnsureNewsAsync(true, CancellationToken.None) ?? Task.FromResult(new NewsSnapshot())); }
            catch { }
        });
        if (_webReady) _web.Dispatcher.InvokeAsync(() => _web.Reload());
    }

    private void ToggleTopmost()
    {
        Topmost = !Topmost;
        _prefs.Topmost = Topmost;
        _ = _prefs.SaveAsync();
        _trayHost?.SetTopmostChecked(Topmost);
    }

    private void ToggleBoard()
    {
        if (IsVisible && WindowState == WindowState.Minimized)
        {
            WindowState = WindowState.Normal;
            Activate();
        }
        else if (IsVisible)
        {
            Hide();
        }
        else
        {
            Show();
            WindowState = WindowState.Normal;
            Activate();
        }
    }

    // ============================= 종료 / 저장 =============================

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_forceQuit) return;
        e.Cancel = true; // X → 트레이로
        PersistState();
        Hide();
    }

    private void ExitApp()
    {
        _forceQuit = true;
        PersistState();
        _trayHost?.Dispose();
        _trayHost = null;
        _server?.Dispose();
        System.Windows.Application.Current.Shutdown();
    }

    private void PersistState()
    {
        if (WindowState == WindowState.Normal)
        {
            _prefs.Width = Width;
            _prefs.Height = Height;
            _prefs.Left = Left;
            _prefs.Top = Top;
        }
        else if (RestoreBounds is { Width: > 0, Height: > 0 } rb)
        {
            _prefs.Width = rb.Width;
            _prefs.Height = rb.Height;
            _prefs.Left = rb.X;
            _prefs.Top = rb.Y;
        }
        _prefs.Topmost = Topmost;
        _ = _prefs.SaveAsync();
    }

    private void ApplyPrefsUi()
    {
        Topmost = _prefs.Topmost;
        _trayHost?.SetTopmostChecked(Topmost);
        // 설정 UI에서 바꾼 자동 시작을 레지스트리(Run 키)에 반영 (Windows 전용)
        if (OperatingSystem.IsWindows())
        {
            if (_prefs.AutoStart && !AutoStart.IsEnabled()) AutoStart.Enable();
            else if (!_prefs.AutoStart && AutoStart.IsEnabled()) AutoStart.Disable();
        }
        if (_prefs.Left is not double px || _prefs.Top is not double py) return;
        if (WindowState == WindowState.Normal && Math.Abs(Left - px) > 2)
        {
            Left = px;
            Top = py;
        }
    }
}
