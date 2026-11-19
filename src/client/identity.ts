const USER_ID_KEY = "smartroom:user-id";
const USER_ID_PATTERN = /^[a-f0-9]{32}$/;

/** Anonymous browser identity used to recover this device's bookings and queue. */
export function getUserId(): { userId: string; persistent: boolean } {
  let storedId: string | null = null;
  let persistent = true;
  try {
    storedId = localStorage.getItem(USER_ID_KEY);
  } catch {
    persistent = false;
  }
  if (storedId && USER_ID_PATTERN.test(storedId)) return { userId: storedId, persistent };

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const userId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(USER_ID_KEY, userId);
  } catch {
    persistent = false;
  }
  return { userId, persistent };
}
