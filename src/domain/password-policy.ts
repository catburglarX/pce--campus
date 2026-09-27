/**
 * Password policy.
 *
 * auth-implement asks for length plus a breached-password check rather than composition rules, because
 * forcing a symbol produces "Password1!" and nothing safer. There is no network here, so the check runs
 * against a bundled list of the passwords that appear most often in public breach corpora, plus the
 * site-specific guesses a student would actually try.
 */

export const MINIMUM_PASSWORD_LENGTH = 10;
export const MAXIMUM_PASSWORD_LENGTH = 200;

/** Lower-cased. Membership is checked case-insensitively, so "Password123" is caught too. */
const COMMON_PASSWORDS = new Set([
  "123456", "123456789", "12345678", "1234567890", "1234567", "password", "password1", "password12",
  "password123", "password1234", "passw0rd", "qwerty", "qwerty123", "qwertyuiop", "abc123", "abcd1234",
  "111111", "000000", "123123", "121212", "654321", "iloveyou", "admin", "administrator", "welcome",
  "welcome1", "welcome123", "letmein", "monkey", "dragon", "sunshine", "princess", "football",
  "baseball", "superman", "trustno1", "master", "shadow", "michael", "jennifer", "computer",
  "asdfghjkl", "zxcvbnm", "1q2w3e4r", "1qaz2wsx", "qazwsx", "changeme", "secret", "starwars",
  "whatever", "freedom", "hello123", "charlie", "aa123456", "abc12345", "test1234", "student",
  "student123", "college", "college123", "hostel123", "mess1234", "india123", "bharat123",
  "jaipur123", "poornima", "poornima123", "pcejaipur", "campus123", "pcecampus", "pce12345",
  "sanjay123", "rahul1234", "krishna123", "ganesh123", "chutiya123", "9876543210", "8765432109",
  "asdf1234", "zaq12wsx", "qwe123456", "iloveyou1", "loveyou123", "mypassword", "newpassword",
  "pass1234", "passpass", "qwertyui", "samsung123", "android123", "internet1", "engineer1",
  "engineering", "btech1234", "semester1", "exam1234", "library123", "canteen123",
]);

export type PasswordVerdict = { acceptable: boolean; reason: string };

export function checkPasswordStrength(password: string, email = ""): PasswordVerdict {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      acceptable: false,
      reason: `Use at least ${MINIMUM_PASSWORD_LENGTH} characters. A short phrase you remember beats a clever short word.`,
    };
  }
  if (password.length > MAXIMUM_PASSWORD_LENGTH) {
    return { acceptable: false, reason: `Keep it under ${MAXIMUM_PASSWORD_LENGTH} characters.` };
  }
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) {
    return { acceptable: false, reason: "That password appears in public breach lists. Pick something else." };
  }
  if (/^(.)\1+$/.test(password)) {
    return { acceptable: false, reason: "One repeated character is not a password." };
  }
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (localPart.length >= 4 && lowered.includes(localPart)) {
    return { acceptable: false, reason: "Do not put your email name inside your password." };
  }
  return { acceptable: true, reason: "" };
}
