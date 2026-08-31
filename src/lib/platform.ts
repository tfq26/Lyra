/**
 * Platform Detection and Native Desktop Bridge for Lyra
 */

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

export const pickDirectory = async (defaultPath?: string): Promise<string | null> => {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath,
        title: 'Select Project Workspace Directory',
      });
      if (typeof selected === 'string') {
        return selected;
      }
    } catch (e) {
      console.warn('Native folder picker failed or not supported in this context:', e);
    }
  }
  return null;
};

export const sendDesktopNotification = async (title: string, body: string) => {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import(
        '@tauri-apps/plugin-notification'
      );
      let permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }
      if (permissionGranted) {
        sendNotification({ title, body });
      }
    } catch (e) {
      console.warn('Failed to send desktop notification:', e);
    }
  }
};
