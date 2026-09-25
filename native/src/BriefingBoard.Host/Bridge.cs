using System.Text.Json;
using System.Text.Json.Serialization;

namespace BriefingBoard.Host;

/// <summary>렌더러(웹 UI)와 주고받는 JSON 메시지 공통 정의</summary>
public static class Bridge
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public sealed class InMessage
    {
        public string? Type { get; set; }
        public string[]? Labels { get; set; }
        public string? Title { get; set; }
        public string? Body { get; set; }
        public string? Url { get; set; }
        public double? Width { get; set; }
        public double? Height { get; set; }
    }

    public static InMessage? ReadIn(string raw)
    {
        try { return JsonSerializer.Deserialize<InMessage>(raw, Json); }
        catch { return null; }
    }

    public sealed class PrefsPatch
    {
        public double? Width { get; set; }
        public double? Height { get; set; }
        public double? Left { get; set; }
        public double? Top { get; set; }
        public bool? Topmost { get; set; }
        public bool? AutoStart { get; set; }
        public int? NewsPollMinutes { get; set; }
        public bool? CalendarEnabled { get; set; }
        public string? CalendarEmail { get; set; }
        public string? CalendarDisplay { get; set; }
        public int? CalendarPollSeconds { get; set; }
        public bool? NotificationsEnabled { get; set; }
        public int? RemindLeadMinutes { get; set; }
    }

    public sealed class CredPatch
    {
        public string? Email { get; set; }
        public string? Password { get; set; }
        public bool? Delete { get; set; }
    }

    public static CredPatch? ReadCred(string raw)
    {
        try { return JsonSerializer.Deserialize<CredPatch>(raw, Json); }
        catch { return null; }
    }

    public static PrefsPatch? ReadPrefs(string raw)
    {
        try { return JsonSerializer.Deserialize<PrefsPatch>(raw, Json); }
        catch { return null; }
    }

    public static string ToJson(object o) => JsonSerializer.Serialize(o, Json);
}
