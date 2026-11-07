/**
 * Kayıttan sonra ne olacağına Supabase'in signUp yanıtı karar verir:
 *  - Oturum geldiyse ("Confirm email" kapalı): kullanıcı zaten giriş yapmıştır →
 *    doğrudan başlangıç sorularına.
 *  - Oturum gelmediyse ("Confirm email" açık): "e-postanı kontrol et" ekranı.
 *    E-posta zaten kayıtlıysa da Supabase oturumsuz yanıt verir; aynı ekran
 *    gösterilir, böylece hesabın var olup olmadığı sızmaz.
 */
export type SignUpOutcome = "onboarding" | "check_email";

type SignUpData = { session?: { access_token?: string } | null } | null | undefined;

export function signUpOutcome(data: SignUpData): SignUpOutcome {
  return data?.session?.access_token ? "onboarding" : "check_email";
}
