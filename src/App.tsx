import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import Background from "./components/Background";
import ProfilePicker from "./components/ProfilePicker";
import Sidebar from "./components/Sidebar";
import Home from "./components/Home";
import ChatView from "./components/ChatView";
import ContextPage from "./components/ContextPage";
import SidePanel from "./components/SidePanel";
import DropOverlay from "./components/DropOverlay";
import { useStore } from "./lib/store";

export default function App() {
  const { loaded, init, profileId, view, panel } = useStore();
  useEffect(() => {
    init();
  }, [init]);

  if (!loaded) return <Background />;

  return (
    <>
      <Background calm={!!profileId && view.type !== "home"} />
      <AnimatePresence mode="wait">
        {!profileId ? (
          <motion.div key="profiles" className="relative z-10 h-full" exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.35 }}>
            <ProfilePicker />
          </motion.div>
        ) : (
          <motion.div
            key="app"
            className="relative z-10 flex h-full"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <Sidebar />
            <main className="relative flex min-w-0 flex-1 flex-col">
              {view.type === "home" && <Home contextId={view.contextId} />}
              {view.type === "chat" && <ChatView key={view.chatId} chatId={view.chatId} />}
              {view.type === "context" && <ContextPage key={view.contextId} contextId={view.contextId} />}
            </main>
            {panel.open && <SidePanel />}
            <DropOverlay />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
