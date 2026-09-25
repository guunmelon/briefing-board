namespace BriefingBoard.Core.Models;

/// <summary>
/// iCloud(CalDAV)에서 받아온 일정. 렌더러의 이벤트 스키마와 호환되게 직렬화한다.
/// id=UID, st=시작 ISO, en=끝 ISO, title, kind, icon, meta(장소).
/// </summary>
public sealed class CalEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Uid { get; set; } = "";
    public string Title { get; set; } = "";

    /// <summary>Core 내부 계산용 (UTC). 렌더러 push 시 St/En ISO 로 변환.</summary>
    public DateTime Start { get; set; } = DateTime.UtcNow;
    public DateTime End { get; set; } = DateTime.UtcNow;

    /// <summary>렌더러 이벤트 스키마 호환 ISO 8601</summary>
    public string St => Start.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");
    public string En => End.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");

    public bool AllDay { get; set; }
    public string? Location { get; set; }
    public string? Calendar { get; set; }
    public string? CalendarColor { get; set; }
    public string[] Categories { get; set; } = Array.Empty<string>();

    /// <summary>meet|work|health|personal 추정</summary>
    public string Kind { get; set; } = "personal";
    public string Icon { get; set; } = "i-clock";
    public string? Meta { get; set; }

    /// <summary>반복이면 다음 발생 기준으로 확장된 단일 인스턴스(클라이언트가 생성)</summary>
    public bool Recurring { get; set; }
}
