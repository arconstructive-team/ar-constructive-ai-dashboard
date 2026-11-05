import { createContext, useContext } from "react";
import type { Author } from "../workspace/types";

/** The signed-in team member. AuthGate provides it; screens read it with useSignedInUser. */
export const SignedInUser = createContext<Author | null>(null);

export function useSignedInUser(): Author | null {
  return useContext(SignedInUser);
}

export function authorName(author: Author): string {
  return author.name || author.email;
}
