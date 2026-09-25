using System.Runtime.InteropServices;

namespace BriefingBoard.Host;

/// <summary>
/// Windows Credential Manager 경량 래퍼 — iCloud 앱 특수 암호를 OS 자격 증명으로 보관한다.
/// (암호가 파일/웹 저장소에 노출되지 않도록)
/// </summary>
public static class CredentialUtil
{
    private const int CredTypeGeneric = 1;
    private const uint CredPersistLocalMachine = 2;
    public const string Target = "BriefingBoard:iCloud";

    [StructLayout(LayoutKind.Sequential)]
    private struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

    [DllImport("Advapi32.dll", SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("Advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);

    /// <summary>저장된 앱 특수 암호(없으면 null)</summary>
    public static string? ReadPassword(string target = Target)
    {
        if (!CredRead(target, CredTypeGeneric, 0, out var ptr)) return null;
        try
        {
            var cred = Marshal.PtrToStructure<CREDENTIAL>(ptr);
            if (cred.CredentialBlob == IntPtr.Zero) return null;
            var bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            return System.Text.Encoding.UTF8.GetString(bytes);
        }
        finally
        {
            CredFree(ptr);
        }
    }

    public static void WritePassword(string userName, string password, string target = Target)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(password);
        var cred = new CREDENTIAL
        {
            Type = CredTypeGeneric,
            Persist = (int)CredPersistLocalMachine,
            TargetName = Marshal.StringToCoTaskMemUni(target),
            UserName = Marshal.StringToCoTaskMemUni(userName),
            CredentialBlobSize = bytes.Length,
            CredentialBlob = Marshal.AllocCoTaskMem(bytes.Length),
        };
        try
        {
            Marshal.Copy(bytes, 0, cred.CredentialBlob, bytes.Length);
            CredWrite(ref cred, 0);
        }
        finally
        {
            Marshal.FreeCoTaskMem(cred.TargetName);
            Marshal.FreeCoTaskMem(cred.UserName);
            Marshal.FreeCoTaskMem(cred.CredentialBlob);
        }
    }

    public static void DeletePassword(string target = Target) => CredDelete(target, CredTypeGeneric, 0);
}
