using System.Threading;
using Forms = System.Windows.Forms;
using Drawing = System.Drawing;

namespace BriefingBoard.Host;

/// <summary>
/// 트레이 아이콘을 전용 STA 스레드 + WinForms 메시지 루프(Application.Run)로 돌리는 호스트.
/// WinForms NotifyIcon/ContextMenu/풍선을 WPF UI 스레드에서 직접 호출하면 메시지 펌프가
/// 얽혀 UI 스레드가 멈추는 문제가 있어, 모든 WinForms 작업을 이 전용 스레드로 격리한다.
/// 호출은 모두 이벤트/Post 로 위임되므로 WPF UI 스레드는 절대 블록되지 않는다.
/// </summary>
public sealed class TrayHost : IDisposable
{
    private readonly object _gate = new();
    private readonly Drawing.Icon _iconImage;
    private readonly ManualResetEventSlim _ready = new(false);
    private Thread? _thread;
    private Forms.NotifyIcon? _icon;
    private Forms.ApplicationContext? _ctx;
    private SynchronizationContext? _sync;          // 트레이 스레드의 WinForms 동기화 컨텍스트
    private volatile bool _topmostChecked;

    // 트레이 스레드에서 발생 — 구독자는 자체 스레드로 마샬링한다(예: WPF Dispatcher.Invoke)
    public event Action? ToggleRequested;
    public event Action? ExitRequested;
    public event Action? RefreshNewsRequested;
    public event Action? BalloonTestRequested;
    public event Action? TopmostToggleRequested;

    public TrayHost(Drawing.Icon iconImage) => _iconImage = iconImage;

    public bool Running => _thread is { IsAlive: true };

    public void Start()
    {
        lock (_gate)
        {
            if (_thread is { IsAlive: true }) return;
            _thread = new Thread(ThreadMain) { Name = "BriefingBoardTray", IsBackground = true };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
        }
        try { _ready.Wait(TimeSpan.FromSeconds(6)); } catch { /* 스레드 실패 시 아래 이벤트 없이도 앱은 계속 */ }
    }

    private void ThreadMain()
    {
        try
        {
            var icon = new Forms.NotifyIcon
            {
                Icon = (Drawing.Icon)_iconImage.Clone(),
                Visible = true,
                Text = "BriefingBoard",
            };
            _icon = icon;

            icon.DoubleClick += (_, _) => ToggleRequested?.Invoke();
            icon.BalloonTipClicked += (_, _) => ToggleRequested?.Invoke();   // 알림 클릭 → 보드 열기

            var menu = new Forms.ContextMenuStrip();
            menu.Items.Add("보드 열기 / 숨기기", null, (_, _) => ToggleRequested?.Invoke());
            menu.Items.Add("뉴스 새로고침", null, (_, _) => RefreshNewsRequested?.Invoke());
            menu.Items.Add("알림 테스트 (풍선)", null, (_, _) => BalloonTestRequested?.Invoke());
            var topItem = new Forms.ToolStripMenuItem("항상 위") { Checked = _topmostChecked };
            topItem.Click += (_, _) => TopmostToggleRequested?.Invoke();
            menu.Items.Add(topItem);
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add("종료", null, (_, _) => ExitRequested?.Invoke());
            icon.ContextMenuStrip = menu;

            // 컨트롤(메뉴) 생성으로 이 스레드에 WinForms 동기화 컨텍스트가 자동 설치됨
            _sync = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            _ctx = new Forms.ApplicationContext();
            _ready.Set();
            Forms.Application.Run(_ctx);   // 이 스레드 전용 메시지 루프
        }
        catch (Exception ex)
        {
            AppLog.Write("TRAY 스레드 예외: " + ex.Message);
        }
        finally
        {
            try { _ready.Set(); } catch { }
            try { _icon?.Dispose(); } catch { }
            _icon = null;
        }
    }

    /// <summary>트레이 스레드에서 풍선을 띄운다 (WPF 스레드 블록 없음).</summary>
    public void ShowBalloon(string title, string text)
    {
        var sync = _sync;
        if (sync is null) return;
        sync.Post(_ =>
        {
            try
            {
                if (_icon is null) return;
                _icon.Visible = true;
                _icon.ShowBalloonTip(5000, title, text, Forms.ToolTipIcon.Info);
            }
            catch (Exception ex) { AppLog.Write("BALLOON 예외: " + ex.Message); }
        }, null);
    }

    /// <summary>'항상 위' 체크 상태를 트레이 메뉴에 반영.</summary>
    public void SetTopmostChecked(bool on) => _topmostChecked = on;

    public void Stop()
    {
        Thread? t;
        lock (_gate) { t = _thread; _thread = null; }
        if (t is null) return;
        var sync = _sync;
        try
        {
            sync?.Post(_ => { try { _ctx?.ExitThread(); } catch { } }, null);
        }
        catch { }
        if (!t.Join(1500))
        {
            // 메시지 루프가 안 끝나면 백그라운드 스레드이므로 프로세스 종료 시 정리됨
            AppLog.Write("TRAY 종료 지연 — 백그라운드 정리");
        }
    }

    public void Dispose()
    {
        Stop();
        try { _ready.Dispose(); } catch { }
        try { _iconImage.Dispose(); } catch { }
    }

    // ============================= 트레이 아이콘 생성 =============================

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    /// <summary>3색 막대 원형 아이콘(16x16) — 트레이·앱 아이콘과 동일한 디자인.</summary>
    public static Drawing.Icon MakeIcon()
    {
        var accent = Drawing.Color.FromArgb(88, 166, 255);
        var mid = Drawing.Color.FromArgb(63, 185, 80);
        var dim = Drawing.Color.FromArgb(139, 148, 158);
        using var bmp = new Drawing.Bitmap(16, 16);
        using (var g = Drawing.Graphics.FromImage(bmp))
        {
            g.Clear(Drawing.Color.Transparent);
            g.SmoothingMode = Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var dark = new Drawing.SolidBrush(Drawing.Color.FromArgb(22, 27, 34));
            g.FillEllipse(dark, 0, 0, 16, 16);          // 원형 백플레이트
            g.FillRectangle(new Drawing.SolidBrush(accent), 3, 3, 10, 2);
            g.FillRectangle(new Drawing.SolidBrush(mid), 3, 7, 10, 2);
            g.FillRectangle(new Drawing.SolidBrush(dim), 3, 11, 10, 2);
        }

        var handle = bmp.GetHicon();
        using (var temp = Drawing.Icon.FromHandle(handle))
        {
            var clone = (Drawing.Icon)temp.Clone();   // 복제본은 핸들 독립
            DestroyIcon(handle);                       // 원본 핸들 정리
            return clone;
        }
    }
}
