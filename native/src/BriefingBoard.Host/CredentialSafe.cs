using BriefingBoard.Core.Storage;

namespace BriefingBoard.Host;

/// <summary>
/// iCloud 앱 특수 암호 보관소.
///  - Windows: 자격 증명 관리자(CredentialUtil)
///  - 그 외(리눅스 개발/검증): %LOCALAPPDATA%\BriefingBoard\secrets.json 파일 폴백
/// 앱 특수 암호는 절대 렌더러/API 응답으로 되돌려주지 않는다(hasPassword 만 노출).
/// </summary>
public static class CredentialSafe
{
    public const string Target = "BriefingBoard:iCloud";

    private static readonly JsonStore Store = new(AppPaths.RootDir);
    private static readonly object Gate = new();
    private static bool IsWin => OperatingSystem.IsWindows();

    private sealed record SecretFile(string Email, string Password);

    public static string? ReadPassword()
    {
        if (IsWin) return CredentialUtil.ReadPassword(Target);
        lock (Gate)
        {
            var f = Store.LoadAsync<SecretFile>("secrets.json").GetAwaiter().GetResult();
            return f?.Password;
        }
    }

    public static bool HasPassword => !string.IsNullOrEmpty(ReadPassword());

    public static void Write(string email, string password)
    {
        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password)) return;
        if (IsWin)
        {
            CredentialUtil.WritePassword(email, password, Target);
            return;
        }
        lock (Gate)
        {
            Store.SaveAsync("secrets.json", new SecretFile(email, password)).GetAwaiter().GetResult();
        }
    }

    public static void Delete()
    {
        if (IsWin)
        {
            CredentialUtil.DeletePassword(Target);
            return;
        }
        lock (Gate)
        {
            Store.Delete("secrets.json");
        }
    }
}
