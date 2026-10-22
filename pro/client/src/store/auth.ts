import { create } from "zustand";
import type { User } from "@ai-video-agent-studio/shared";
import { api, setCsrfToken } from "../api";

type AuthStatus = "loading" | "anonymous" | "authenticated";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  init: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  init: async () => {
    try {
      const session = await api.me();
      setCsrfToken(session.csrfToken);
      set({ status: "authenticated", user: session.user });
    } catch {
      setCsrfToken("");
      set({ status: "anonymous", user: null });
    }
  },
  login: async (password) => {
    const session = await api.login(password);
    setCsrfToken(session.csrfToken);
    set({ status: "authenticated", user: session.user });
  },
  logout: async () => {
    try {
      await api.logout();
    } finally {
      setCsrfToken("");
      set({ status: "anonymous", user: null });
    }
  },
  setUser: (user) => set({ user }),
}));
