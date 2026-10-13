// App state (zustand) persisted to the browser's IndexedDB, scoped per profile.
import { create } from "zustand";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import type { Chat, Ctx, Message, Panel, Profile, ProfileData, SourceRec, View } from "./types";
import { uid } from "./files";

const EMPTY: ProfileData = { contexts: [], chats: [], sources: {} };

interface State extends ProfileData {
  loaded: boolean;
  profiles: Profile[];
  profileId: string | null;
  view: View;
  panel: Panel;
  sidebarOpen: boolean;
  language: string; // output language name, e.g. "English", "Hindi"
  setLanguage: (l: string) => void;
  privateMode: boolean; // run everything on local Gemma (Ollama)
  setPrivateMode: (on: boolean) => void;

  init: () => Promise<void>;
  saveProfiles: (p: Profile[]) => void;
  selectProfile: (id: string | null) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;

  setView: (v: View) => void;
  setPanel: (p: Partial<Panel>) => void;
  setSidebar: (open: boolean) => void;

  upsertSource: (s: SourceRec) => void;
  patchSource: (id: string, patch: Partial<SourceRec>) => void;

  createChat: (contextId: string | null) => Chat;
  patchChat: (id: string, patch: Partial<Chat>) => void;
  deleteChat: (id: string) => void;
  addMessage: (chatId: string, m: Omit<Message, "id" | "createdAt">) => string;
  patchMessage: (chatId: string, msgId: string, patch: Partial<Message> | ((m: Message) => Partial<Message>)) => void;

  createContext: (c: Pick<Ctx, "name" | "emoji" | "color" | "description" | "instructions">) => Ctx;
  patchContext: (id: string, patch: Partial<Ctx>) => void;
  deleteContext: (id: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => {
  const persist = () => {
    const { profileId, contexts, chats, sources } = get();
    if (!profileId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // Strip transient flags before saving.
      const clean: ProfileData = {
        contexts: contexts.map((c) => ({ ...c, analyzing: false })),
        chats,
        sources,
      };
      idbSet(`data:${profileId}`, clean).catch(console.error);
    }, 400);
  };
  const update = (fn: (s: State) => Partial<State>) => {
    set(fn);
    persist();
  };

  return {
    ...EMPTY,
    loaded: false,
    profiles: [],
    profileId: null,
    view: { type: "home" },
    panel: { open: false, mode: "graph" },
    sidebarOpen: typeof window !== "undefined" ? window.innerWidth > 900 : true,
    language: (() => {
      try {
        return localStorage.getItem("contextos-language") || "English";
      } catch {
        return "English";
      }
    })(),
    privateMode: (() => {
      try {
        return localStorage.getItem("contextos-private") === "1";
      } catch {
        return false;
      }
    })(),
    setPrivateMode(privateMode) {
      set({ privateMode });
      try {
        localStorage.setItem("contextos-private", privateMode ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    setLanguage(language) {
      set({ language });
      try {
        localStorage.setItem("contextos-language", language);
      } catch {
        /* ignore */
      }
    },

    async init() {
      const profiles = ((await idbGet("profiles")) as Profile[] | undefined) ?? [];
      set({ profiles, loaded: true });
    },
    saveProfiles(profiles) {
      set({ profiles });
      idbSet("profiles", profiles).catch(console.error);
    },
    async selectProfile(id) {
      if (!id) {
        set({ profileId: null, ...EMPTY, view: { type: "home" }, panel: { open: false, mode: "graph" } });
        return;
      }
      const data = ((await idbGet(`data:${id}`)) as ProfileData | undefined) ?? EMPTY;
      // Sources that were mid-processing when the page closed cannot resume.
      for (const s of Object.values(data.sources))
        if (s.status === "uploading" || s.status === "processing") {
          s.status = "error";
          s.error = "Interrupted. Please add the file again.";
        }
      for (const c of data.chats)
        for (const m of c.messages) {
          if (m.streaming) m.streaming = false;
          if (m.kind === "working") m.done = true;
        }
      set({ profileId: id, ...data, view: { type: "home" }, panel: { open: false, mode: "graph" } });
    },
    async deleteProfile(id) {
      const data = (await idbGet(`data:${id}`)) as ProfileData | undefined;
      if (data) for (const sid of Object.keys(data.sources)) await idbDel(`blob:${sid}`);
      await idbDel(`data:${id}`);
      get().saveProfiles(get().profiles.filter((p) => p.id !== id));
    },

    setView: (view) => set({ view, panel: { ...get().panel, open: false } }),
    setPanel: (p) => set({ panel: { ...get().panel, ...p } }),
    setSidebar: (sidebarOpen) => set({ sidebarOpen }),

    upsertSource: (s) => update((st) => ({ sources: { ...st.sources, [s.id]: s } })),
    patchSource: (id, patch) =>
      update((st) => (st.sources[id] ? { sources: { ...st.sources, [id]: { ...st.sources[id], ...patch } } } : {})),

    createChat(contextId) {
      const chat: Chat = {
        id: uid(),
        contextId,
        title: "New chat",
        messages: [],
        sourceIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      update((st) => ({ chats: [chat, ...st.chats] }));
      return chat;
    },
    patchChat: (id, patch) =>
      update((st) => ({ chats: st.chats.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)) })),
    deleteChat: (id) =>
      update((st) => ({
        chats: st.chats.filter((c) => c.id !== id),
        view: st.view.type === "chat" && st.view.chatId === id ? { type: "home" } : st.view,
      })),
    addMessage(chatId, m) {
      const id = uid();
      update((st) => ({
        chats: st.chats.map((c) =>
          c.id === chatId ? { ...c, messages: [...c.messages, { ...m, id, createdAt: Date.now() }], updatedAt: Date.now() } : c,
        ),
      }));
      return id;
    },
    patchMessage(chatId, msgId, patch) {
      update((st) => ({
        chats: st.chats.map((c) =>
          c.id !== chatId
            ? c
            : {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === msgId ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m,
                ),
              },
        ),
      }));
    },

    createContext(c) {
      const ctx: Ctx = { ...c, id: uid(), sourceIds: [], createdAt: Date.now() };
      update((st) => ({ contexts: [ctx, ...st.contexts] }));
      return ctx;
    },
    patchContext: (id, patch) =>
      update((st) => ({ contexts: st.contexts.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    deleteContext: (id) =>
      update((st) => ({
        contexts: st.contexts.filter((c) => c.id !== id),
        chats: st.chats.filter((c) => c.contextId !== id),
        view: (st.view.type === "context" && st.view.contextId === id) ||
          (st.view.type === "chat" && st.chats.find((c) => c.id === (st.view as any).chatId)?.contextId === id)
          ? { type: "home" }
          : st.view,
      })),
  };
});

export const saveBlob = (id: string, blob: Blob) => idbSet(`blob:${id}`, blob);
export const loadBlob = (id: string) => idbGet(`blob:${id}`) as Promise<Blob | undefined>;
