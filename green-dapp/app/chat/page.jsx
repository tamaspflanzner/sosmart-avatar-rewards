"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet } from "../../lib/useWallet";
import Nav from "../components/Nav";
import AvatarShowcase from "../components/AvatarShowcase";
import { apiGet, apiPost, communityName, formatLastActive, shortAddr } from "../lib/api";

function ChatPageInner() {
  const searchParams = useSearchParams();
  const { address, isConnected } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedThread, setSelectedThread] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatErrorDismissed, setChatErrorDismissed] = useState(false);

  // Auto-clear chatError after 6s
  useEffect(() => {
    if (!chatError) { setChatErrorDismissed(false); return; }
    setChatErrorDismissed(false);
    const t = window.setTimeout(() => setChatErrorDismissed(true), 6000);
    return () => window.clearTimeout(t);
  }, [chatError]);
  const listRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const walletReady = mounted && isConnected && address;
  const requestedWallet = String(searchParams?.get("with") || "").trim().toLowerCase();
  const requestedGroupId = Number(searchParams?.get("group") || 0);

  useEffect(() => {
    let cancelled = false;

    async function loadInbox() {
      if (!walletReady) {
        setConversations([]);
        setGroups([]);
        setSelectedThread("");
        setMessages([]);
        setDraft("");
        setError("");
        return;
      }

      setInboxLoading(true);
      setError("");
      try {
        const [inboxJson, socialJson] = await Promise.all([
          apiGet(`/api/users/${address}/direct-inbox`),
          apiGet(`/api/users/${address}/social`),
        ]);
        if (cancelled) return;

        const nextConversations = (inboxJson?.conversations || []).map((entry) => ({
          ...entry,
          threadType: "dm",
          threadKey: `dm:${normalizeWallet(entry.walletAddress)}`,
        }));
        const nextGroups = (socialJson?.groups || []).map((group) => ({
          ...group,
          threadType: "group",
          threadKey: `group:${group.id}`,
        }));
        setConversations(nextConversations);
        setGroups(nextGroups);

        const requestedDmKey =
          requestedWallet && nextConversations.some((entry) => normalizeWallet(entry.walletAddress) === requestedWallet)
            ? `dm:${requestedWallet}`
            : "";
        if (requestedDmKey) {
          setSelectedThread(requestedDmKey);
          return;
        }

        const requestedGroupKey =
          Number.isFinite(requestedGroupId) && requestedGroupId > 0 && nextGroups.some((group) => Number(group.id) === requestedGroupId)
            ? `group:${requestedGroupId}`
            : "";
        if (requestedGroupKey) {
          setSelectedThread(requestedGroupKey);
          return;
        }

        setSelectedThread((prev) => {
          if (
            prev &&
            [...nextConversations, ...nextGroups].some((entry) => String(entry.threadKey) === String(prev))
          ) {
            return prev;
          }
          return nextConversations[0]?.threadKey || nextGroups[0]?.threadKey || "";
        });
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setInboxLoading(false);
      }
    }

    loadInbox();
    return () => {
      cancelled = true;
    };
  }, [walletReady, address, requestedWallet, requestedGroupId]);

  const filteredConversations = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations;

    return conversations.filter((entry) => {
      const name = communityName(entry.customDisplayName, entry.walletAddress).toLowerCase();
      const wallet = String(entry.walletAddress || "").toLowerCase();
      const short = shortAddr(entry.walletAddress).toLowerCase();
      return name.includes(needle) || wallet.includes(needle) || short.includes(needle);
    });
  }, [conversations, search]);

  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return groups;

    return groups.filter((group) => {
      const name = String(group.name || "").toLowerCase();
      const description = String(group.description || "").toLowerCase();
      return name.includes(needle) || description.includes(needle);
    });
  }, [groups, search]);

  const selectedEntry =
    filteredConversations.find((entry) => entry.threadKey === selectedThread) ||
    filteredGroups.find((entry) => entry.threadKey === selectedThread) ||
    conversations.find((entry) => entry.threadKey === selectedThread) ||
    groups.find((entry) => entry.threadKey === selectedThread) ||
    null;

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      if (!walletReady || !selectedEntry) {
        setMessages([]);
        setChatError("");
        return;
      }

      setMessagesLoading(true);
      setChatError("");
      try {
        const json =
          selectedEntry.threadType === "group"
            ? await apiGet(`/api/groups/${selectedEntry.id}/messages?wallet=${address}`)
            : await apiGet(`/api/users/${address}/direct-messages/${selectedEntry.walletAddress}`);
        if (!cancelled) setMessages(json?.messages || []);
      } catch (e) {
        if (!cancelled) setChatError(String(e?.message || e));
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }

    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [walletReady, address, selectedEntry]);

  useEffect(() => {
    if (!walletReady || !selectedEntry) return;
    if (selectedEntry.threadType === "group") {
      apiPost(`/api/groups/${selectedEntry.id}/messages/read`, { walletAddress: address })
        .then((json) => {
          setGroups((prev) =>
            prev.map((entry) => (Number(entry.id) === Number(selectedEntry.id) ? { ...entry, unreadCount: 0 } : entry))
          );
          if (Array.isArray(json?.groups)) {
            setGroups((json.groups || []).map((group) => ({ ...group, threadType: "group", threadKey: `group:${group.id}` })));
          }
        })
        .catch(() => {});
      return;
    }
    apiPost(`/api/users/${address}/direct-messages/${selectedEntry.walletAddress}/read`, {})
      .then(() => {
        setConversations((prev) =>
          prev.map((entry) =>
            normalizeWallet(entry.walletAddress) === normalizeWallet(selectedEntry.walletAddress)
              ? { ...entry, unreadCount: 0 }
              : entry
          )
        );
      })
      .catch(() => {});
  }, [walletReady, address, selectedEntry?.threadKey]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, selectedEntry?.threadKey]);

  async function sendMessage() {
    if (!walletReady || !selectedEntry || !draft.trim()) return;

    setSending(true);
    setChatError("");
    try {
      const json =
        selectedEntry.threadType === "group"
          ? await apiPost(`/api/groups/${selectedEntry.id}/messages`, {
              walletAddress: address,
              messageText: draft.trim(),
            })
          : await apiPost(`/api/users/${address}/direct-messages/${selectedEntry.walletAddress}`, {
              senderWallet: address,
              messageText: draft.trim(),
            });
      const nextMessages = json?.messages || [];
      setMessages(nextMessages);
      setDraft("");
      const latestMessage = nextMessages[nextMessages.length - 1] || null;
      if (selectedEntry.threadType === "group") {
        setGroups((prev) =>
          [...prev]
            .map((entry) =>
              Number(entry.id) === Number(selectedEntry.id)
                ? {
                    ...entry,
                    updatedAt: latestMessage?.createdAt || entry.updatedAt,
                    lastMessage: latestMessage
                      ? {
                          ...latestMessage,
                          message: latestMessage.message,
                        }
                      : entry.lastMessage,
                  }
                : entry
            )
            .sort(compareGroupOrder)
        );
      } else {
        setConversations((prev) =>
          [...prev]
            .map((entry) =>
              normalizeWallet(entry.walletAddress) === normalizeWallet(selectedEntry.walletAddress)
                ? {
                    ...entry,
                    lastMessage: latestMessage || entry.lastMessage,
                  }
                : entry
            )
            .sort(compareConversationOrder)
        );
      }
    } catch (e) {
      setChatError(String(e?.message || e));
    } finally {
      setSending(false);
    }
  }

  function insertEmoji(emoji) {
    setDraft((prev) => `${prev}${emoji}`);
    setEmojiOpen(false);
  }

  function onComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending && draft.trim()) {
        sendMessage();
      }
    }
  }

  return (
    <div className="shell chat-mobile">
      <Nav />

      <div className="topbar">
        <div className="title">
          <h1 className="h1">Chat</h1>
        </div>
      </div>

      {error ? <ChatAlert message={error} onDismiss={() => setError("")} /> : null}

      <div className="grid">
        <div className="card" style={{ gridColumn: "span 4", ...chatCardFrame }}>
          <div className="accent cyan" />
          <div className="card-inner" style={sidebarInner}>
            <div className="section-title">Conversations <span className="hint">friends + groups</span></div>
            <div className="small" style={{ marginTop: 8 }}>
              {walletReady ? `Wallet: ${shortAddr(address)}` : "Connect your wallet to open chat."}
            </div>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={walletReady ? "Search by name or wallet" : "Connect wallet to search"}
              disabled={!walletReady || inboxLoading}
              className="chat-search-input"
            />

            <div style={conversationList}>
              {walletReady ? (
                inboxLoading && conversations.length === 0 ? (
                  <div className="small">Loading conversations...</div>
                ) : filteredConversations.length === 0 && filteredGroups.length === 0 ? (
                  <div className="small">
                    {search.trim() ? "No matching chats found." : "No accepted friends or groups yet. Use Community first."}
                  </div>
                ) : (
                  <>
                    {filteredConversations.length > 0 ? <div style={sidebarLabel}>Direct messages</div> : null}
                    {filteredConversations.map((entry) => {
                      const active = entry.threadKey === selectedEntry?.threadKey;
                      return (
                        <button
                          key={entry.threadKey}
                          type="button"
                          onClick={() => setSelectedThread(entry.threadKey)}
                          className={active ? "conv-card conv-card--active" : "conv-card"}
                        >
                          <AvatarShowcase layout={entry.avatar?.layout} size={72} rounded={18} />
                          <div style={{ minWidth: 0, textAlign: "left" }}>
                            <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.1 }}>
                              {communityName(entry.customDisplayName, entry.walletAddress)}
                            </div>
                            <div className="mono" style={{ marginTop: 4 }}>{shortAddr(entry.walletAddress)}</div>
                            <div className="conv-preview">
                              {entry.lastMessage?.message || "No messages yet. Start the conversation."}
                            </div>
                            <div className="small" style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              {entry.lastMessage?.createdAt ? formatInboxTimestamp(entry.lastMessage.createdAt) : "Friend connection"}
                              <span>{formatLastActive(entry.presence)}</span>
                              {entry.unreadCount ? <span className="unread-badge">{entry.unreadCount} new</span> : null}
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    {filteredGroups.length > 0 ? <div style={sidebarLabel}>Group chats</div> : null}
                    {filteredGroups.map((group) => {
                      const active = group.threadKey === selectedEntry?.threadKey;
                      return (
                        <button
                          key={group.threadKey}
                          type="button"
                          onClick={() => setSelectedThread(group.threadKey)}
                          className={active ? "conv-card conv-card--active" : "conv-card"}
                        >
                          <ThreadAvatar entry={group} size={72} rounded={18} />
                          <div style={{ minWidth: 0, textAlign: "left" }}>
                            <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.1 }}>{group.name}</div>
                            <div className="small" style={{ marginTop: 4 }}>
                              {group.viewerRole === "owner" ? "Owner" : "Member"} · {group.members?.length || 0} members
                            </div>
                            <div className="conv-preview">
                              {group.lastMessage?.message || group.description || "Group conversation"}
                            </div>
                            <div className="small" style={{ marginTop: 6 }}>
                              {group.lastMessage?.createdAt
                                ? formatInboxTimestamp(group.lastMessage.createdAt)
                                : group.updatedAt
                                ? formatInboxTimestamp(group.updatedAt)
                                : "Group"}
                              {group.unreadCount ? <span className="unread-badge" style={{ marginLeft: 8 }}>{group.unreadCount} new</span> : null}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </>
                )
              ) : (
                <div className="small">Connect wallet to load your chats.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ gridColumn: "span 8", ...chatCardFrame }}>
          <div className="accent green" />
          <div className="card-inner" style={chatInner}>
            {selectedEntry ? (
              <>
                <div style={chatHeader}>
                  <div style={chatHeaderIdentity}>
                    <ThreadAvatar entry={selectedEntry} size={84} rounded={20} />
                    <div>
                      <div className="section-title" style={{ margin: 0 }}>
                        {selectedEntry.threadType === "group"
                          ? selectedEntry.name
                          : communityName(selectedEntry.customDisplayName, selectedEntry.walletAddress)}
                      </div>
                      <div className="mono" style={{ marginTop: 6 }}>
                        {selectedEntry.threadType === "group"
                          ? `${selectedEntry.members?.length || 0} members`
                          : shortAddr(selectedEntry.walletAddress)}
                      </div>
                      <div className="small" style={{ marginTop: 6 }}>
                        {selectedEntry.threadType === "group"
                          ? selectedEntry.activeChallenge
                            ? `${selectedEntry.activeChallenge.title} · ${Math.round(selectedEntry.activeChallenge.progressKm || 0)}/${Math.round(selectedEntry.activeChallenge.targetKm || 0)} km`
                            : "No active challenge"
                          : formatLastActive(selectedEntry.presence)}
                      </div>
                    </div>
                  </div>
                  {selectedEntry.threadType === "group" ? (
                    <Link href="/community" className="pill">
                      Open groups
                    </Link>
                  ) : (
                    <Link href={`/community/${selectedEntry.walletAddress}`} className="pill">
                      View profile
                    </Link>
                  )}
                </div>

                {chatError && !chatErrorDismissed ? (
                  <ChatAlert message={chatError} onDismiss={() => setChatErrorDismissed(true)} compact />
                ) : null}

                <div ref={listRef} style={messagesPanel}>
                  {messagesLoading && messages.length === 0 ? (
                    <div className="small">Loading messages...</div>
                  ) : messages.length === 0 ? (
                    <div className="chat-empty-state">
                      <div className="chat-empty-icon">
                        {selectedEntry.threadType === "group" ? "🫂" : "💬"}
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 20 }}>
                        {selectedEntry.threadType === "group" ? "Start your group chat" : "Start your chat"}
                      </div>
                      <div className="small" style={{ marginTop: 8, opacity: 0.72 }}>
                        {selectedEntry.threadType === "group"
                          ? `Send the first message to ${selectedEntry.name}.`
                          : `Send the first message to ${communityName(selectedEntry.customDisplayName, selectedEntry.walletAddress)}.`}
                      </div>
                    </div>
                  ) : (
                    messages.map((message) => {
                      const mine = normalizeWallet(message.senderWallet) === normalizeWallet(address);
                      return (
                        <div key={message.id} style={mine ? myMessageRow : otherMessageRow}>
                          <div style={mine ? myBubble : otherBubble}>
                            <div style={{ fontWeight: 800, marginBottom: 6 }}>
                              {mine
                                ? "You"
                                : selectedEntry.threadType === "group"
                                ? communityName(message.senderDisplayName, message.senderWallet)
                                : communityName(selectedEntry.customDisplayName, selectedEntry.walletAddress)}
                            </div>
                            <div style={{ whiteSpace: "pre-wrap" }}>{message.message}</div>
                            <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>
                              {formatMessageTimestamp(message.createdAt)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div style={composerWrap}>
                  <div style={composerMainRow}>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onComposerKeyDown}
                      placeholder="Write a message..."
                      disabled={!walletReady || sending}
                      style={composerInput}
                      rows={3}
                    />
                    <div style={composerActions}>
                      <div style={composerToolbar}>
                        <button
                          type="button"
                          className="pill"
                          onClick={() => setEmojiOpen((prev) => !prev)}
                          style={emojiButton}
                        >
                          Add emoji
                        </button>
                        {emojiOpen ? (
                          <div style={emojiPanel}>
                            {EMOJI_OPTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => insertEmoji(emoji)}
                                style={emojiChip}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="pill"
                        onClick={sendMessage}
                        disabled={!walletReady || sending || !draft.trim()}
                        style={sendButton}
                      >
                        {sending ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="chat-empty-state">
                <div className="chat-empty-icon">💬</div>
                <div style={{ fontWeight: 900, fontSize: 22 }}>No conversation selected</div>
                <div className="small" style={{ marginTop: 8, opacity: 0.72 }}>
                  {walletReady ? "Pick a friend or group from the left side to open your chat." : "Connect wallet first to access your messages."}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatAlert({ message, onDismiss, compact = false }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      padding: compact ? "10px 14px" : "13px 16px",
      borderRadius: 14,
      border: "1px solid rgba(239,68,68,.30)",
      background: "rgba(239,68,68,.10)",
      backdropFilter: "blur(8px)",
      fontSize: compact ? 13 : 14,
      color: "rgba(255,200,200,.95)",
      lineHeight: 1.45,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,.9)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "rgba(255,200,200,.70)",
          padding: "0 2px",
          lineHeight: 1,
          flexShrink: 0,
        }}
        title="Bezárás"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function ThreadAvatar({ entry, size, rounded }) {
  if (entry?.threadType === "group") {
    const members = Array.isArray(entry.members) ? entry.members.slice(0, 3) : [];
    return (
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          flex: "0 0 auto",
        }}
      >
        {members.length === 0 ? (
          <div
            style={{
              width: size,
              height: size,
              borderRadius: rounded,
              border: "1px solid rgba(255,255,255,.10)",
              background: "linear-gradient(180deg, rgba(34,211,238,.18), rgba(255,255,255,.04))",
            }}
          />
        ) : (
          members.map((member, index) => {
            const avatarSize = members.length === 1 ? size : members.length === 2 ? Math.round(size * 0.68) : Math.round(size * 0.58);
            const positions =
              members.length === 1
                ? [{ left: 0, top: 0 }]
                : members.length === 2
                ? [
                    { left: 0, top: Math.round(size * 0.16) },
                    { left: Math.round(size * 0.32), top: 0 },
                  ]
                : [
                    { left: 0, top: Math.round(size * 0.2) },
                    { left: Math.round(size * 0.32), top: 0 },
                    { left: Math.round(size * 0.42), top: Math.round(size * 0.38) },
                  ];

            return (
              <div
                key={`${member.walletAddress}-${index}`}
                style={{
                  position: "absolute",
                  left: positions[index]?.left ?? 0,
                  top: positions[index]?.top ?? 0,
                  zIndex: index + 1,
                  filter: "drop-shadow(0 8px 16px rgba(0,0,0,.18))",
                }}
              >
                <AvatarShowcase layout={member.avatar?.layout} size={avatarSize} rounded={Math.max(12, Math.round(rounded * 0.72))} />
              </div>
            );
          })
        )}
      </div>
    );
  }

  return <AvatarShowcase layout={entry?.avatar?.layout} size={size} rounded={rounded} />;
}

function compareConversationOrder(a, b) {
  const aTime = a?.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
  const bTime = b?.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
  if (bTime !== aTime) return bTime - aTime;
  return communityName(a?.customDisplayName, a?.walletAddress).localeCompare(
    communityName(b?.customDisplayName, b?.walletAddress)
  );
}

function compareGroupOrder(a, b) {
  const aTime = a?.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bTime = b?.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  if (bTime !== aTime) return bTime - aTime;
  return String(a?.name || "").localeCompare(String(b?.name || ""));
}

function normalizeWallet(value) {
  return String(value || "").trim().toLowerCase();
}

function formatMessageTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatInboxTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const sidebarInner = {
  display: "grid",
  gridTemplateRows: "auto auto auto 1fr",
  gap: 0,
  height: "100%",
  minHeight: 0,
};

const chatInner = {
  display: "grid",
  gridTemplateRows: "auto auto 1fr auto",
  gap: 14,
  height: "100%",
  minHeight: 0,
};

const chatCardFrame = {
  height: "min(720px, calc(100vh - 180px))",
  overflow: "hidden",
};

const textInput = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.05)",
  color: "rgba(255,255,255,.96)",
  padding: "10px 14px",
  outline: "none",
  fontSize: 14,
};

const conversationList = {
  display: "grid",
  gap: 12,
  marginTop: 14,
  alignContent: "start",
  overflowY: "auto",
  minHeight: 0,
  paddingRight: 4,
};

const conversationCard = {
  display: "grid",
  gridTemplateColumns: "72px 1fr",
  gap: 12,
  alignItems: "center",
  width: "100%",
  borderRadius: 20,
  padding: 12,
  border: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.03)",
  color: "inherit",
  cursor: "pointer",
};

const activeConversationCard = {
  ...conversationCard,
  border: "1px solid rgba(34,211,238,.42)",
  background: "linear-gradient(180deg, rgba(34,211,238,.16), rgba(255,255,255,.05))",
  boxShadow: "0 10px 24px rgba(34,211,238,.10)",
};

const conversationPreview = {
  marginTop: 6,
  fontSize: 13,
  opacity: 0.85,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const sidebarLabel = {
  marginTop: 16,
  marginBottom: 8,
  fontSize: 12,
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity: 0.72,
};

const chatHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  paddingBottom: 14,
  borderBottom: "1px solid rgba(255,255,255,.08)",
};

const chatHeaderIdentity = {
  display: "grid",
  gridTemplateColumns: "84px 1fr",
  gap: 14,
  alignItems: "center",
};

const messagesPanel = {
  display: "grid",
  gap: 12,
  alignContent: "start",
  overflowY: "auto",
  minHeight: 0,
  height: "100%",
  padding: 8,
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,.08)",
  background: "linear-gradient(180deg, rgba(8,14,32,.58), rgba(0,0,0,.22))",
};

const myMessageRow = {
  display: "flex",
  justifyContent: "flex-end",
};

const otherMessageRow = {
  display: "flex",
  justifyContent: "flex-start",
};

const bubbleBase = {
  maxWidth: "74%",
  borderRadius: 22,
  padding: "14px 16px",
  border: "1px solid rgba(255,255,255,.08)",
  boxShadow: "0 14px 32px rgba(0,0,0,.16)",
};

const myBubble = {
  ...bubbleBase,
  background: "linear-gradient(180deg, rgba(34,211,238,.24), rgba(16,185,129,.16))",
};

const otherBubble = {
  ...bubbleBase,
  background: "rgba(255,255,255,.05)",
};

const composerWrap = {
  display: "grid",
  gap: 12,
  alignItems: "stretch",
};

const composerToolbar = {
  display: "flex",
  alignItems: "center",
  position: "relative",
  justifyContent: "flex-end",
};

const composerMainRow = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 12,
  alignItems: "end",
};

const composerActions = {
  display: "grid",
  gap: 10,
  alignContent: "end",
  justifyItems: "end",
};

const composerInput = {
  width: "100%",
  resize: "none",
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.05)",
  color: "rgba(255,255,255,.96)",
  padding: "16px 18px",
  outline: "none",
  minHeight: 96,
  font: "inherit",
};

const sendButton = {
  minWidth: 120,
  cursor: "pointer",
};

const emojiButton = {
  minWidth: 120,
  cursor: "pointer",
};

const emojiPanel = {
  position: "absolute",
  right: 0,
  bottom: "calc(100% + 10px)",
  display: "grid",
  gridTemplateColumns: "repeat(6, 44px)",
  gap: 8,
  width: "max-content",
  padding: 12,
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,.12)",
  background: "linear-gradient(180deg, rgba(20,28,48,.96), rgba(10,14,26,.96))",
  boxShadow: "0 18px 40px rgba(0,0,0,.24)",
  zIndex: 5,
};

const emojiChip = {
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.05)",
  borderRadius: 12,
  padding: "8px 10px",
  cursor: "pointer",
  fontSize: 20,
  lineHeight: 1,
};

const unreadBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(34,211,238,.16)",
  border: "1px solid rgba(34,211,238,.35)",
  color: "rgba(220,250,255,.98)",
  fontSize: 11,
  fontWeight: 900,
};

const emptyChatState = {
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  alignContent: "center",
  minHeight: 320,
  padding: 24,
};

const EMOJI_OPTIONS = [
  "😀",
  "😂",
  "😍",
  "😎",
  "🥳",
  "🤝",
  "🔥",
  "✨",
  "💚",
  "🚲",
  "🚌",
  "🌿",
  "🌧️",
  "🌞",
  "🎉",
  "💬",
  "🙌",
  "👍",
];
