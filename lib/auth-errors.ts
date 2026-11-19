import type {
  SignInWithUsernamePasswordResult,
  SignUpWithUsernamePasswordResult,
} from "@convex-dev/auth/methods/username-password/react";

type Failure<T> = T extends { userError: infer Error } ? Error : never;
type AuthUserError = Failure<
  | SignInWithUsernamePasswordResult
  | SignUpWithUsernamePasswordResult
>;

export function authErrorMessage(error: AuthUserError): string {
  switch (error.error) {
    case "USERNAME_TOO_SHORT":
      return "Escribe tu correo para continuar.";
    case "USERNAME_TOO_LONG":
      return `Tu correo no puede tener más de ${error.maximumLength} caracteres.`;
    case "USERNAME_HAS_SURROUNDING_WHITESPACE":
    case "USERNAME_HAS_INVALID_CHARACTERS":
      return "Revisa tu correo: contiene espacios o caracteres no permitidos.";
    case "USERNAME_TAKEN":
      return "Ya existe una cuenta con ese correo. Intenta iniciar sesión.";
    case "USER_NOT_FOUND":
    case "INVALID_CREDENTIALS":
      return "Revisa tu correo y contraseña.";
    case "PASSWORD_TOO_SHORT":
      return `La contraseña debe tener al menos ${error.minimumLength} caracteres.`;
    case "PASSWORD_TOO_LONG":
      return `La contraseña no puede tener más de ${error.maximumLength} caracteres.`;
    case "PASSWORD_HAS_SURROUNDING_WHITESPACE":
      return "La contraseña no puede empezar ni terminar con espacios.";
    case "PASSWORD_TOO_COMMON":
      return "Esta contraseña es demasiado común. Elige una más segura.";
    case "RATE_LIMITED":
      return `Demasiados intentos. Vuelve a probar en ${Math.ceil(error.retryAfterMs / 1000)} segundos.`;
    case "OTHER_ERROR":
      return "No pudimos completar la solicitud. Revisa tu conexión y vuelve a intentar.";
    default:
      error satisfies never;
      return "No pudimos completar la solicitud.";
  }
}
