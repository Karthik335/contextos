import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronRight, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, SquarePen, Trash2, Users } from "lucide-react";
import { useStore } from "../lib/store";
import { AVATAR_GRADIENTS } from "../lib/files";
import ContextDialog from "./ContextDialog";
import StatusPill from "./StatusPill";
import ThemeToggle from "./ThemeToggle";
import type { Ctx } from "../lib/types";

export default function Sidebar() {
  const st = useStore();
  const { sidebarOpen, setSidebar, profiles, profileId, contexts, chats, view, setView } = st;
  const profile = profiles.find((p) => p.id === profileId);
  const [dialog, setDialog] = useState<Ctx | "new" | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const standalone = chats.filter((c) => !c.contextId);

  const activeChat = view.type === "chat" ? view.chatId : null;
  const activeCtx = view.type === "context" ? view.contextId : view.type === "home" ? view.contextId : null;
  const isMobile = typeof window !== "undefined" && window.innerWidth < 900;
  const go = (fn: () => void) => {
    fn();
    if (isMobile) setSidebar(false);
  };

  if (!sidebarOpen)
    return (
      <div className="absolute left-3 top-3 z-30 flex flex-col gap-2">
        <IconBtn title="Open sidebar" onClick={() => setSidebar(true)}>
          <PanelLeftOpen size={18} />
        </IconBtn>
        <IconBtn title="New chat" onClick={() => setView({ type: "home" })}>
          <SquarePen size={18} />
        </IconBtn>
        <ThemeToggle className="glass" />
      </div>
    );

  return (
    <>
      {isMobile && <div className="fixed inset-0 z-30 bg-scrim" onClick={() => setSidebar(false)} />}
      <motion.aside
        initial={{ x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className={`glass z-40 m-3 mr-0 flex w-[272px] shrink-0 flex-col rounded-3xl ${isMobile ? "fixed inset-y-0 left-0" : "relative"}`}
      >
        {/* Brand + collapse */}
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div className="flex items-center gap-2">
            <div className="orb size-6 rounded-full" />
            <span className="text-[17px] font-extrabold tracking-tight">
              Context<span className="text-brand">OS</span>
            </span>
          </div>
          <div className="flex items-center">
            <ThemeToggle />
            <IconBtn title="Close sidebar" onClick={() => setSidebar(false)} plain>
              <PanelLeftClose size={18} />
            </IconBtn>
          </div>
        </div>

        <div className="px-3">
          <button
            onClick={() => go(() => setView({ type: "home" }))}
            className="mt-2 flex w-full items-center gap-2.5 rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/25 transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <SquarePen size={16} /> New chat
          </button>
        </div>

        <div className="thin-scroll mt-4 flex-1 overflow-y-auto px-3 pb-3">
          <SectionTitle
            label="Contexts"
            action={
              <button onClick={() => setDialog("new")} title="New context" className="rounded-lg p-1 text-ink-soft hover:bg-surface/70 hover:text-accent">
                <Plus size={15} />
              </button>
            }
          />
          {contexts.length === 0 && (
            <button onClick={() => setDialog("new")} className="mb-2 w-full rounded-2xl border border-dashed border-ink/15 px-3 py-3 text-left text-xs text-ink-soft hover:border-accent/50 hover:text-accent">
              <span className="font-semibold">+ New context</span>
              <br />A project with shared files, instructions and many chats.
            </button>
          )}
          {contexts.map((ctx) => {
            const ctxChats = chats.filter((c) => c.contextId === ctx.id);
            const open = expanded[ctx.id] ?? (activeCtx === ctx.id || ctxChats.some((c) => c.id === activeChat));
            return (
              <div key={ctx.id} className="mb-0.5">
                <Row
                  active={activeCtx === ctx.id}
                  onClick={() => go(() => setView({ type: "context", contextId: ctx.id }))}
                  icon={
                    <span className="flex items-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded({ ...expanded, [ctx.id]: !open });
                        }}
                        className="mr-0.5 rounded p-0.5 text-ink-soft hover:bg-surface"
                      >
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <span className="text-base leading-none">{ctx.emoji}</span>
                    </span>
                  }
                  label={ctx.name}
                  dot={ctx.color}
                  menu={[
                    { label: "Edit", icon: Pencil, run: () => setDialog(ctx) },
                    { label: "Delete", icon: Trash2, danger: true, run: () => confirm(`Delete context "${ctx.name}" and its chats?`) && st.deleteContext(ctx.id) },
                  ]}
                />
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-6">
                      {ctxChats.map((c) => (
                        <Row
                          key={c.id}
                          small
                          active={activeChat === c.id}
                          onClick={() => go(() => setView({ type: "chat", chatId: c.id }))}
                          label={c.title}
                          menu={[{ label: "Delete", icon: Trash2, danger: true, run: () => st.deleteChat(c.id) }]}
                        />
                      ))}
                      <button onClick={() => go(() => setView({ type: "home", contextId: ctx.id }))} className="w-full rounded-xl px-3 py-1.5 text-left text-xs font-medium text-ink-soft hover:bg-surface/60 hover:text-accent">
                        + New chat in {ctx.name}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          <SectionTitle label="Recents" />
          {standalone.length === 0 && <p className="px-3 text-xs text-ink-soft/80">Your chats will appear here.</p>}
          {standalone.map((c) => (
            <Row
              key={c.id}
              active={activeChat === c.id}
              onClick={() => go(() => setView({ type: "chat", chatId: c.id }))}
              icon={<MessageSquare size={14} className="text-ink-soft" />}
              label={c.title}
              menu={[{ label: "Delete", icon: Trash2, danger: true, run: () => st.deleteChat(c.id) }]}
            />
          ))}
        </div>

        <StatusPill />
        {/* Profile */}
        {profile && (
          <button
            onClick={() => st.selectProfile(null)}
            className="m-3 mt-0 flex items-center gap-3 rounded-2xl bg-surface/70 p-2.5 text-left transition hover:bg-surface"
            title="Switch profile"
          >
            <span className="grid size-9 place-items-center rounded-xl text-lg" style={{ background: AVATAR_GRADIENTS[profile.hue % AVATAR_GRADIENTS.length] }}>
              {profile.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-ink-soft">Analysing as</span>
              <span className="block truncate text-sm font-semibold">{profile.name}</span>
            </span>
            <Users size={16} className="text-ink-soft" />
          </button>
        )}
      </motion.aside>

      <AnimatePresence>
        {dialog && (
          <ContextDialog
            initial={dialog === "new" ? undefined : dialog}
            onClose={() => setDialog(null)}
            onSave={(v) => {
              if (dialog === "new") {
                const ctx = st.createContext(v);
                setView({ type: "context", contextId: ctx.id });
              } else st.patchContext(dialog.id, v);
              setDialog(null);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function SectionTitle({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="mb-1 mt-3 flex items-center justify-between px-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft/80">{label}</span>
      {action}
    </div>
  );
}

function IconBtn({ children, onClick, title, plain }: { children: React.ReactNode; onClick: () => void; title: string; plain?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={`rounded-xl p-2 text-ink-soft transition hover:text-accent ${plain ? "hover:bg-surface/60" : "glass hover:-translate-y-0.5"}`}>
      {children}
    </button>
  );
}

interface MenuItem {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  run: () => unknown;
  danger?: boolean;
}

function Row({
  label,
  icon,
  active,
  onClick,
  menu,
  dot,
  small,
}: {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  menu?: MenuItem[];
  dot?: string;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={onClick}
      className={`group relative flex cursor-pointer items-center gap-2 rounded-xl px-2.5 ${small ? "py-1.5 text-[13px]" : "py-2 text-sm"} transition ${
        active ? "bg-surface/90 font-semibold text-ink shadow-sm" : "text-ink/85 hover:bg-surface/55"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} />}
      {menu && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          className="rounded-md p-0.5 text-ink-soft opacity-0 hover:bg-surface group-hover:opacity-100"
        >
          <MoreHorizontal size={15} />
        </button>
      )}
      {open && menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => (e.stopPropagation(), setOpen(false))} />
          <div className="glass-strong absolute right-1 top-8 z-50 w-36 rounded-xl p-1" onClick={(e) => e.stopPropagation()}>
            {menu.map((m) => (
              <button
                key={m.label}
                onClick={() => {
                  setOpen(false);
                  m.run();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-ink/5 ${m.danger ? "text-conflict" : ""}`}
              >
                <m.icon size={14} /> {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
