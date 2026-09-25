using System.Text.Json;
using System.Text.Json.Serialization;

namespace BriefingBoard.Core.Storage;

/// <summary>JSON 파일 저장소 (원자적 쓰기: tmp 후 이동). 상태·뉴스 캐시·일정 캐시 공용.</summary>
public sealed class JsonStore
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
    };

    public string RootDir { get; }

    public JsonStore(string rootDir)
    {
        RootDir = rootDir;
        Directory.CreateDirectory(RootDir);
    }

    public string FullPath(string name)
    {
        var safe = name.Replace("..", "").Replace("/", "_").Replace("\\", "_");
        return Path.Combine(RootDir, safe.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? safe : safe + ".json");
    }

    public async Task<T?> LoadAsync<T>(string name) where T : class
    {
        var path = FullPath(name);
        if (!File.Exists(path)) return null;
        try
        {
            await using var fs = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<T>(fs, Options);
        }
        catch
        {
            return null;
        }
    }

    public async Task SaveAsync<T>(string name, T value)
    {
        var path = FullPath(name);
        var tmp = path + ".tmp";
        await using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            await JsonSerializer.SerializeAsync(fs, value, Options);
        }
        File.Move(tmp, path, true);
    }

    public void Delete(string name)
    {
        try { File.Delete(FullPath(name)); } catch { /* 무시 */ }
    }
}
