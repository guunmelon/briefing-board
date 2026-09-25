using System.Text.Json;
using BriefingBoard.Core.Storage;

namespace BriefingBoard.Host;

/// <summary>호스트(창) 설정 — host.json</summary>
public sealed class Preferences
{
    public double Width { get; set; } = 1100;
    public double Height { get; set; } = 780;

    /// <summary>null=미기억(화면 중앙). 창 이동 시 갱신되어 재시작 시 복원된다.</summary>
    public double? Left { get; set; }
    public double? Top { get; set; }
    public bool Topmost { get; set; } = true;
    public bool AutoStart { get; set; } = false;
    public int NewsPollMinutes { get; set; } = 15;
    public bool CalendarEnabled { get; set; } = false;
    public string? CalendarEmail { get; set; }
    public string? CalendarDisplay { get; set; }
    public int CalendarPollSeconds { get; set; } = 60;

    /// <summary>Windows 알림(새 브리핑·일정 임박) 사용 여부 — 트레이 풍선.</summary>
    public bool NotificationsEnabled { get; set; } = true;

    /// <summary>일정 시작 몇 분 전에 알림을 보낼지. (설정 UI 는 추후)</summary>
    public int RemindLeadMinutes { get; set; } = 10;

    /// <summary>false=WebView2 GPU 가속 끔(흰 화면/렌더 프리즈 회피 기본값). true=하드웨어 가속 켬.</summary>
    public bool UseGpu { get; set; } = false;

    private static readonly JsonStore Store = new(AppPaths.RootDir);

    public static async Task<Preferences> LoadAsync()
    {
        var p = await Store.LoadAsync<Preferences>("host.json");
        if (p == null) p = new Preferences();
        if (p.Width < 700) p.Width = 1100;
        if (p.Height < 500) p.Height = 780;
        return p;
    }

    public Task SaveAsync() => Store.SaveAsync("host.json", this);
}
