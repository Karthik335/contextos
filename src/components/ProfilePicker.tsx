import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { useStore } from "../lib/store";
import { AVATAR_GRADIENTS, uid } from "../lib/files";
import type { Profile } from "../lib/types";
import ThemeToggle from "./ThemeToggle";

const EMOJIS = ["🦊", "🐼", "🦉", "🐯", "🐙", "🦄", "🐳", "🌸", "🚀", "🎧", "📚", "⚡"];

/** Netflix-style "Who's analysing?" screen. Profiles live in this browser only. */
export default function ProfilePicker() {
  const { profiles, saveProfiles, selectProfile, deleteProfile } = useStore();
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [pinFor, setPinFor] = useState<Profile | null>(null);

  const open = (p: Profile) => {
    if (manage) return setEditing(p);
    if (p.pin) return setPinFor(p);
    selectProfile(p.id);
  };

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-6">
      <ThemeToggle className="glass absolute right-5 top-5" />
      <motion.h1
        className="headline text-center text-5xl sm:text-7xl"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {manage ? "Manage profiles" : "Who's analysing?"}
      </motion.h1>

      <div className="mt-12 flex max-w-4xl flex-wrap justify-center gap-6 sm:gap-8">
        {profiles.map((p, i) => (
          <motion.button
            key={p.id}
            onClick={() => open(p)}
            className="group flex w-28 flex-col items-center gap-3 sm:w-36"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.06, type: "spring", stiffness: 200, damping: 18 }}
          >
            <div
              className="relative grid aspect-square w-full place-items-center rounded-[28px] text-5xl shadow-lg ring-4 ring-transparent transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-2xl group-hover:ring-edge-strong sm:text-6xl"
              style={{ background: AVATAR_GRADIENTS[p.hue % AVATAR_GRADIENTS.length] }}
            >
              <span className="drop-shadow-sm">{p.emoji}</span>
              {manage && (
                <span className="absolute inset-0 grid place-items-center rounded-[28px] bg-scrim text-white">
                  <Pencil size={26} />
                </span>
              )}
              {!manage && p.pin && (
                <span className="absolute bottom-2 right-2 rounded-full bg-surface/80 p-1 text-ink-soft">
                  <Lock size={12} />
                </span>
              )}
            </div>
            <span className="text-base font-semibold text-on-bg drop-shadow sm:text-lg">{p.name}</span>
          </motion.button>
        ))}

        <motion.button
          onClick={() => setEditing({ id: "", name: "", emoji: EMOJIS[profiles.length % EMOJIS.length], hue: profiles.length })}
          className="group flex w-28 flex-col items-center gap-3 sm:w-36"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + profiles.length * 0.06 }}
        >
          <div className="glass grid aspect-square w-full place-items-center rounded-[28px] border-2 border-dashed border-edge text-ink-soft transition-all duration-300 group-hover:-translate-y-1.5 group-hover:text-accent">
            <Plus size={40} />
          </div>
          <span className="text-base font-semibold text-on-bg drop-shadow sm:text-lg">Add profile</span>
        </motion.button>
      </div>

      {profiles.length > 0 && (
        <button
          onClick={() => setManage(!manage)}
          className="glass mt-12 rounded-full px-6 py-2.5 text-sm font-semibold text-ink transition hover:-translate-y-0.5"
        >
          {manage ? "Done" : "Manage profiles"}
        </button>
      )}
      <p className="mt-6 text-xs font-medium text-ink/60">Profiles and data are stored in this browser only.</p>

      <AnimatePresence>
        {editing && (
          <ProfileEditor
            initial={editing}
            onClose={() => setEditing(null)}
            onSave={(p) => {
              const next = p.id ? profiles.map((x) => (x.id === p.id ? p : x)) : [...profiles, { ...p, id: uid() }];
              saveProfiles(next);
              setEditing(null);
            }}
            onDelete={
              editing.id
                ? async () => {
                    if (confirm(`Delete "${editing.name}" and all its contexts and chats?`)) {
                      await deleteProfile(editing.id);
                      setEditing(null);
                    }
                  }
                : undefined
            }
          />
        )}
        {pinFor && <PinPad profile={pinFor} onClose={() => setPinFor(null)} onOk={() => selectProfile(pinFor.id)} />}
      </AnimatePresence>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="glass-strong relative w-full max-w-md rounded-3xl p-7"
        initial={{ y: 24, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
      >
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1.5 text-ink-soft hover:bg-ink/5">
          <X size={18} />
        </button>
        {children}
      </motion.div>
    </motion.div>
  );
}

function ProfileEditor({
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Profile;
  onClose: () => void;
  onSave: (p: Profile) => void;
  onDelete?: () => void;
}) {
  const [p, setP] = useState(initial);
  const [pin, setPin] = useState(initial.pin ?? "");
  const valid = p.name.trim() && (pin === "" || /^\d{4}$/.test(pin));
  return (
    <Modal onClose={onClose}>
      <h2 className="text-xl font-bold">{initial.id ? "Edit profile" : "Add profile"}</h2>
      <div className="mt-5 flex items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center rounded-3xl text-4xl" style={{ background: AVATAR_GRADIENTS[p.hue % AVATAR_GRADIENTS.length] }}>
          {p.emoji}
        </div>
        <input
          autoFocus
          value={p.name}
          onChange={(e) => setP({ ...p, name: e.target.value.slice(0, 20) })}
          placeholder="Name"
          className="w-full rounded-xl border border-ink/10 bg-surface/80 px-4 py-3 text-base outline-none focus:border-accent"
        />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-soft">Avatar</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => setP({ ...p, emoji: e })} className={`grid size-10 place-items-center rounded-xl text-xl transition ${p.emoji === e ? "bg-accent/15 ring-2 ring-accent" : "hover:bg-ink/5"}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {AVATAR_GRADIENTS.map((g, i) => (
          <button key={g} onClick={() => setP({ ...p, hue: i })} className={`size-8 rounded-full transition ${p.hue % AVATAR_GRADIENTS.length === i ? "ring-2 ring-ink ring-offset-2" : ""}`} style={{ background: g }} />
        ))}
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-soft">PIN (optional, 4 digits)</p>
      <input
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        placeholder="No PIN"
        className="mt-2 w-40 rounded-xl border border-ink/10 bg-surface/80 px-4 py-2.5 tracking-[0.5em] outline-none focus:border-accent"
      />
      <div className="mt-7 flex items-center justify-between">
        {onDelete ? (
          <button onClick={onDelete} className="flex items-center gap-1.5 text-sm font-medium text-conflict hover:underline">
            <Trash2 size={15} /> Delete profile
          </button>
        ) : (
          <span />
        )}
        <button
          disabled={!valid}
          onClick={() => onSave({ ...p, name: p.name.trim(), pin: pin || undefined })}
          className="flex items-center gap-1.5 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-md transition hover:-translate-y-0.5 disabled:opacity-40"
        >
          <Check size={16} /> Save
        </button>
      </div>
    </Modal>
  );
}

function PinPad({ profile, onClose, onOk }: { profile: Profile; onClose: () => void; onOk: () => void }) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const press = (d: string) => {
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      if (next === profile.pin) onOk();
      else {
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setPin("");
        }, 450);
      }
    }
  };
  return (
    <Modal onClose={onClose}>
      <div className="text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl text-3xl" style={{ background: AVATAR_GRADIENTS[profile.hue % AVATAR_GRADIENTS.length] }}>
          {profile.emoji}
        </div>
        <h2 className="mt-3 text-lg font-bold">Enter PIN for {profile.name}</h2>
        <motion.div className="mt-4 flex justify-center gap-3" animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`size-3.5 rounded-full transition ${i < pin.length ? "bg-accent" : "bg-ink/15"}`} />
          ))}
        </motion.div>
        <div className="mx-auto mt-6 grid w-60 grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
            k === "" ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                onClick={() => (k === "⌫" ? setPin(pin.slice(0, -1)) : press(k))}
                className="rounded-2xl bg-surface/80 py-3.5 text-lg font-semibold shadow-sm transition hover:bg-surface active:scale-95"
              >
                {k}
              </button>
            ),
          )}
        </div>
      </div>
    </Modal>
  );
}
