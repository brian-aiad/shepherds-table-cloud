// src/auth/useAuth.ts
// Hook wrapper around the AuthContext. Exports BOTH default and named hook.

import { useContext } from "react";
import { AuthContext, type AuthValue } from "./AuthProvider";

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

export default useAuth;
