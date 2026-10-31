/**
 * Platform Helpers for Lyra Web Mission Control
 */

export const isTauri = (): boolean => false;

export const pickDirectory = async (_defaultPath?: string): Promise<string | null> => {
  return null;
};

export const sendDesktopNotification = async (title: string, body: string) => {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          new Notification(title, { body });
        }
      }
    } catch (e) {
      console.warn('Web notification failed:', e);
    }
  }
};
