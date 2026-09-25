using BriefingBoard.Core.Models;

namespace BriefingBoard.Core.Notify;

/// <summary>
/// 알림 판정 순수 로직(네트워크 없음 — 단위 검증용).
///  - 일정 시작 전 리마인더: 시작 시각이 (now, now+lead] 범위이며 아직 알림 안 한 것
///  - 새 브리핑 도착: 이전 대비 새로 등장한 헤드라인 수 (첫 로드는 기준점만, 알림 0건)
/// </summary>
public static class NotifyPlanner
{
    public static string NewsKey(NewsItem n) => n.Topic + "\u0001" + n.Title;
    public static string EventKey(CalEvent e) => "ev:" + (string.IsNullOrEmpty(e.Uid) ? e.Id : e.Uid);

    /// <summary>
    /// 알림을 보낼 일정을 고른다. 종일·이미 끝난(또는 시작한) 일정은 제외하고,
    /// 미래 시작이 [now .. now+leadMinutes] 안인 것만. 보낸 키는 alreadyReminded 에 기록(멱등).
    /// </summary>
    public static List<CalEvent> DueReminders(IEnumerable<CalEvent> events, DateTime nowUtc,
        int leadMinutes, ISet<string> alreadyReminded)
    {
        var due = new List<CalEvent>();
        var from = nowUtc.ToUniversalTime();
        var limit = from.AddMinutes(Math.Max(1, leadMinutes));
        foreach (var e in events)
        {
            if (e.AllDay) continue;
            var start = e.Start.ToUniversalTime();
            var end = e.End.ToUniversalTime();
            if (end <= from) continue;            // 이미 끝남
            if (start <= from) continue;          // 이미 시작됨 — 시작 전 알림 대상 아님
            if (start > limit) continue;          // 아직 먼 일정
            if (!alreadyReminded.Add(EventKey(e))) continue;   // 이미 알림 보냄
            due.Add(e);
        }
        return due;
    }

    /// <summary>
    /// seen 에 없는 아이템 키를 추가하며 새로 추가된(=알림 대상) 수를 돌려준다.
    /// baselineEstablished 가 false 면(첫 수집/최초 실행) 카운트 없이 기준점만 만든다.
    /// </summary>
    public static int TrackNew(ISet<string> seen, IEnumerable<NewsItem> items, bool baselineEstablished)
    {
        int fresh = 0;
        foreach (var it in items)
        {
            var k = NewsKey(it);
            if (seen.Add(k) && baselineEstablished) fresh++;
        }
        return fresh;
    }
}
