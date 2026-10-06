"use client";

import Link from "next/link";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { hardhat } from "wagmi/chains";
import { useWallet } from "../../lib/useWallet";
import Nav from "../components/Nav";
import AvatarShowcase from "../components/AvatarShowcase";
import { apiDelete, apiGet, apiPost, communityName, fmt, formatLastActive, shortAddr } from "../lib/api";

function CommunityPageInner() {
  const { address, isConnected } = useWallet();
  const searchParams = useSearchParams();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: hardhat.id });
  const [mounted, setMounted] = useState(false);
  const [activeSection, setActiveSection] = useState("social");
  const [data, setData] = useState(null);
  const [groupLeaderboard, setGroupLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [social, setSocial] = useState({
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    groups: [],
    pendingGroupInvites: [],
  });
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialMessage, setSocialMessage] = useState("");
  const [friendWallet, setFriendWallet] = useState("");
  const [friendActionKey, setFriendActionKey] = useState("");

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [groupCreating, setGroupCreating] = useState(false);
  const [groupInviteWallets, setGroupInviteWallets] = useState({});
  const [groupChallengeDrafts, setGroupChallengeDrafts] = useState({});
  const [groupActionKey, setGroupActionKey] = useState("");
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState(null);
  const [handledQrFriendWallet, setHandledQrFriendWallet] = useState("");

  async function loadLeaderboard() {
    setLoading(true);
    setError("");
    try {
      const [userJson, groupJson] = await Promise.all([
        apiGet("/api/stats/leaderboard"),
        apiGet("/api/groups/leaderboard"),
      ]);
      setData(userJson);
      setGroupLeaderboard(groupJson?.groups || []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function loadSocial(walletAddress) {
    if (!walletAddress) {
      setSocial({
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
        groups: [],
        pendingGroupInvites: [],
      });
      return;
    }

    setSocialLoading(true);
    setSocialMessage("");
    try {
      const json = await apiGet(`/api/users/${walletAddress}/social`);
      setSocial({
        friends: json?.friends || [],
        incomingRequests: json?.incomingRequests || [],
        outgoingRequests: json?.outgoingRequests || [],
        groups: json?.groups || [],
        pendingGroupInvites: json?.pendingGroupInvites || [],
      });
    } catch (e) {
      setSocialMessage(`Could not load social data: ${String(e?.message || e)}`);
    } finally {
      setSocialLoading(false);
    }
  }

  useEffect(() => {
    loadLeaderboard();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadOwnProfile() {
      if (!isConnected || !address) {
        setDisplayName("");
        setSaveMessage("");
        return;
      }

      setProfileLoading(true);
      setSaveMessage("");
      try {
        const json = await apiGet(`/api/users/${address}/profile`);
        if (!cancelled) setDisplayName(json?.displayName || "");
      } catch (e) {
        if (!cancelled) setSaveMessage(`Could not load current name: ${String(e?.message || e)}`);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    loadOwnProfile();
    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  useEffect(() => {
    if (!isConnected || !address) {
      setSocial({
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
        groups: [],
        pendingGroupInvites: [],
      });
      setSocialMessage("");
      return;
    }
    loadSocial(address);
  }, [isConnected, address]);

  const top = data?.top || [];
  const walletReady = mounted && isConnected && address;
  const walletLabel = !mounted ? "Loading wallet..." : walletReady ? shortAddr(address) : "Connect wallet";
  const summary = {
    friends: social.friends.length,
    incoming: social.incomingRequests.length,
    groups: social.groups.length,
    invites: social.pendingGroupInvites.length,
  };

  useEffect(() => {
    const section = String(searchParams?.get("section") || "").trim().toLowerCase();
    if (section === "social" || section === "groups" || section === "leaderboard") {
      setActiveSection(section);
    }
  }, [searchParams]);

  useEffect(() => {
    const qrWallet = String(searchParams?.get("addFriend") || "").trim().toLowerCase();
    if (!mounted || !qrWallet || !walletReady || socialLoading) return;
    if (handledQrFriendWallet === qrWallet) return;

    if (qrWallet === String(address || "").toLowerCase()) {
      setHandledQrFriendWallet(qrWallet);
      setFriendWallet("");
      setSocialMessage("You cannot add yourself from your own QR code.");
      return;
    }

    const alreadyConnected =
      social.friends.some((entry) => entry.walletAddress === qrWallet) ||
      social.incomingRequests.some((entry) => entry.walletAddress === qrWallet) ||
      social.outgoingRequests.some((entry) => entry.walletAddress === qrWallet);

    if (alreadyConnected) {
      setHandledQrFriendWallet(qrWallet);
      setFriendWallet(qrWallet);
      setSocialMessage("This QR friend link is already connected to your social state.");
      return;
    }

    setHandledQrFriendWallet(qrWallet);
    setFriendWallet(qrWallet);
    setActiveSection("social");
    setFriendActionKey(`send:${qrWallet}`);
    setSocialMessage("");
    (async () => {
      try {
        const json = await apiPost(`/api/users/${address}/friend-requests`, {
          friendWallet: qrWallet,
        });
        setSocialFromResponse(json);
        setSocialMessage(json?.autoAccepted ? "Mutual request detected, you are now friends." : "Friend request sent.");
      } catch (e) {
        setSocialMessage(String(e?.message || e));
      } finally {
        setFriendActionKey("");
      }
    })();
  }, [
    searchParams,
    mounted,
    walletReady,
    socialLoading,
    handledQrFriendWallet,
    address,
    social.friends,
    social.incomingRequests,
    social.outgoingRequests,
  ]);

  function setSocialFromResponse(json) {
    setSocial((prev) => ({
      friends: json?.friends || [],
      incomingRequests: json?.incomingRequests || [],
      outgoingRequests: json?.outgoingRequests || [],
      groups: json?.groups || prev.groups,
      pendingGroupInvites: json?.pendingGroupInvites || prev.pendingGroupInvites,
    }));
  }

  async function saveDisplayName() {
    if (!isConnected || !address || saving) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const json = await apiPost(`/api/users/${address}/profile`, {
        displayName: displayName.trim() || null,
      });
      setDisplayName(json?.displayName || "");
      setSaveMessage(json?.displayName ? "Community name saved." : "Community name cleared.");
      await loadLeaderboard();
    } catch (e) {
      setSaveMessage(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function sendFriendRequest(nextWalletOverride) {
    if (!isConnected || !address) return;
    const nextWallet = String(nextWalletOverride ?? friendWallet).trim();
    if (!nextWallet) return;
    setFriendActionKey(`send:${nextWallet}`);
    setSocialMessage("");
    try {
      const json = await apiPost(`/api/users/${address}/friend-requests`, {
        friendWallet: nextWallet,
      });
      setSocialFromResponse(json);
      if (!nextWalletOverride) setFriendWallet("");
      setSocialMessage(json?.autoAccepted ? "Mutual request detected, you are now friends." : "Friend request sent.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setFriendActionKey("");
    }
  }

  async function runFriendAction(actionKey, path, successMessage) {
    if (!isConnected || !address) return;
    setFriendActionKey(actionKey);
    setSocialMessage("");
    try {
      const json = await apiPost(path, {});
      setSocialFromResponse(json);
      setSocialMessage(successMessage);
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setFriendActionKey("");
    }
  }

  async function removeFriend(walletToRemove) {
    if (!isConnected || !address || !walletToRemove) return;
    setFriendActionKey(`remove:${walletToRemove}`);
    setSocialMessage("");
    try {
      await apiDelete(`/api/users/${address}/friends/${walletToRemove}`);
      await loadSocial(address);
      setSocialMessage("Friend removed from your list.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setFriendActionKey("");
    }
  }

  async function createGroup() {
    if (!isConnected || !address || !newGroupName.trim()) return;
    setGroupCreating(true);
    setSocialMessage("");
    try {
      await apiPost("/api/groups", {
        ownerWallet: address,
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || null,
      });
      setNewGroupName("");
      setNewGroupDescription("");
      await loadSocial(address);
      setSocialMessage("Group created.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupCreating(false);
    }
  }

  async function inviteToGroup(groupId) {
    if (!isConnected || !address) return;
    const inviteeWallet = String(groupInviteWallets[groupId] || "").trim();
    if (!inviteeWallet) return;
    setGroupActionKey(`invite:${groupId}:${inviteeWallet}`);
    setSocialMessage("");
    try {
      await apiPost(`/api/groups/${groupId}/invites`, {
        inviterWallet: address,
        inviteeWallet,
      });
      setGroupInviteWallets((prev) => ({ ...prev, [groupId]: "" }));
      await loadSocial(address);
      setSocialMessage("Group invite sent.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupActionKey("");
    }
  }

  async function runGroupInviteAction(actionKey, path, successMessage) {
    if (!isConnected || !address) return;
    setGroupActionKey(actionKey);
    setSocialMessage("");
    try {
      const json = await apiPost(path, { walletAddress: address });
      setSocialFromResponse(json);
      setSocialMessage(successMessage);
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupActionKey("");
    }
  }

  async function saveGroupChallenge(groupId) {
    if (!isConnected || !address) return;
    const draft = groupChallengeDrafts[groupId] || {};
    const startsAt = draft.startsAt || getDefaultChallengeStart();
    const endsAt = draft.endsAt || getDefaultChallengeEnd();
    if (!String(draft.title || "").trim() || !Number(draft.targetKm) || !startsAt || !endsAt) return;
    setGroupActionKey(`challenge:${groupId}`);
    setSocialMessage("");
    try {
      await apiPost(`/api/groups/${groupId}/challenge`, {
        walletAddress: address,
        title: String(draft.title || "").trim(),
        targetKm: Number(draft.targetKm),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      await loadSocial(address);
      await loadLeaderboard();
      setSocialMessage("Group challenge saved.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupActionKey("");
    }
  }

  async function claimGroupCrown(groupId) {
    if (!isConnected || !address) return;
    if (!walletClient || !publicClient) {
      setSocialMessage("Wallet is not ready.");
      return;
    }
    setGroupActionKey(`claim-crown:${groupId}`);
    setSocialMessage("");
    try {
      const rewards = await apiGet(`/api/users/${address}/rewards`);
      const targetChainId = Number(rewards?.chainId || hardhat.id);

      if (chainId !== targetChainId) {
        if (!switchChainAsync) {
          throw new Error(`Please switch wallet network to chain ${targetChainId}.`);
        }
        await switchChainAsync({ chainId: targetChainId });
      }

      const txHash = await walletClient.sendTransaction({
        account: walletClient.account,
        to: rewards?.burnAddress,
        value: 0n,
        chain: hardhat,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });
      if (receipt.status !== "success") {
        throw new Error("Crown claim transaction reverted.");
      }

      const json = await apiPost(`/api/groups/${groupId}/crown-claim`, {
        walletAddress: address,
        txHash,
        chainId: targetChainId,
      });
      await loadSocial(address);
      setSocialMessage(json?.alreadyClaimed ? "Crown reward resynced on-chain." : "Reward crown claimed on-chain.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupActionKey("");
    }
  }

  async function updateGroupRole(groupId, targetWallet, role) {
    if (!isConnected || !address) return;
    setGroupActionKey(`role:${groupId}:${targetWallet}:${role}`);
    setSocialMessage("");
    try {
      await apiPost(`/api/groups/${groupId}/roles`, {
        walletAddress: address,
        targetWallet,
        role,
      });
      await loadSocial(address);
      setSocialMessage(role === "admin" ? "Admin role granted." : "Member role restored.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupActionKey("");
    }
  }

  async function removeGroupMember(groupId, targetWallet) {
    if (!isConnected || !address) return;
    setGroupActionKey(`kick:${groupId}:${targetWallet}`);
    setSocialMessage("");
    try {
      await apiDelete(`/api/groups/${groupId}/members/${targetWallet}`, {
        walletAddress: address,
      });
      await loadSocial(address);
      setSocialMessage("Member removed from group.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupActionKey("");
    }
  }

  async function deleteGroup(groupId) {
    if (!isConnected || !address) return;
    setGroupActionKey(`delete:${groupId}`);
    setSocialMessage("");
    try {
      await apiDelete(`/api/groups/${groupId}`, {
        walletAddress: address,
        confirm: "DELETE",
      });
      setConfirmDeleteGroupId(null);
      await loadSocial(address);
      await loadLeaderboard();
      setSocialMessage("Group deleted.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupActionKey("");
    }
  }

  async function leaveGroup(groupId) {
    if (!isConnected || !address) return;
    setGroupActionKey(`leave:${groupId}`);
    setSocialMessage("");
    try {
      await apiDelete(`/api/groups/${groupId}/leave`, {
        walletAddress: address,
      });
      await loadSocial(address);
      await loadLeaderboard();
      setSocialMessage("You left the group.");
    } catch (e) {
      setSocialMessage(String(e?.message || e));
    } finally {
      setGroupActionKey("");
    }
  }

  function getDefaultChallengeStart() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }

  function getDefaultChallengeEnd() {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }

  return (
    <div className="shell community-mobile">
      <Nav />

      <div className="topbar">
        <div className="title">
          <h1 className="h1">Community</h1>
          <p className="subtitle">Friends, groups and public avatar showcase in focused sections.</p>
        </div>
      </div>

      {error ? <div className="error">Error: {error}</div> : null}

      <div className="grid">
        <div className="card" style={{ gridColumn: "span 12" }}>
          <div className="accent green" />
          <div className="card-inner">
            <div className="section-title">Community Hub <span className="hint">cleaner structure</span></div>
            <div className="small" style={{ marginTop: 8 }}>
              Wallet: <span className="mono">{walletLabel}</span>
            </div>
            <div className="community-summary-grid" style={summaryGrid}>
              <SummaryMini title="Friends" value={summary.friends} hint="accepted" />
              <SummaryMini title="Incoming" value={summary.incoming} hint="requests" />
              <SummaryMini title="Groups" value={summary.groups} hint="joined" />
              <SummaryMini title="Invites" value={summary.invites} hint="group invites" />
            </div>
            <div style={sectionTabs}>
              <button type="button" className="pill community-tab-btn" onClick={() => setActiveSection("social")} style={activeSection === "social" ? activeTabBtn : tabBtn}>
                <span>🌐</span> Social
                {social.incomingRequests.length > 0 ? <span className="community-tab-badge">{social.incomingRequests.length}</span> : null}
              </button>
              <button type="button" className="pill community-tab-btn" onClick={() => setActiveSection("groups")} style={activeSection === "groups" ? activeTabBtn : tabBtn}>
                <span>👥</span> Groups
                {social.pendingGroupInvites.length > 0 ? <span className="community-tab-badge">{social.pendingGroupInvites.length}</span> : null}
              </button>
              <button type="button" className="pill community-tab-btn" onClick={() => setActiveSection("leaderboard")} style={activeSection === "leaderboard" ? activeTabBtn : tabBtn}>
                <span>🏆</span> Leaderboard
              </button>
            </div>
          </div>
        </div>

        {activeSection === "social" ? (
          <>
            <div className="card" style={{ gridColumn: "span 12" }}>
              <div className="accent green" />
              <div className="card-inner">
                <div className="section-title">Your community name <span className="hint">profile identity</span></div>
                <div className="small" style={{ marginTop: 8 }}>Set the public name shown on profile and leaderboard cards.</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!walletReady || profileLoading || saving} maxLength={32} placeholder={walletReady ? "Example: Levente RideKing" : "Connect wallet to set a name"} style={textInput} />
                  <button type="button" className="pill" onClick={saveDisplayName} disabled={!walletReady || profileLoading || saving} style={actionBtn}>
                    {saving ? "Saving..." : "Save name"}
                  </button>
                </div>
                {saveMessage ? <div className="small" style={{ marginTop: 8 }}>{saveMessage}</div> : null}
              </div>
            </div>

            <div className="card" style={{ gridColumn: "span 12" }}>
              <div className="accent cyan" />
              <div className="card-inner">
                <div className="section-title">Friend Requests <span className="hint">inbox + sent</span></div>
                <div className="small" style={{ marginTop: 8 }}>Send a request first, and accepted requests become mutual friendships.</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
                  <input value={friendWallet} onChange={(e) => setFriendWallet(e.target.value)} disabled={!walletReady || socialLoading || !!friendActionKey} placeholder={walletReady ? "Paste wallet address or username here" : "Connect wallet to manage friends"} style={textInput} />
                  <button type="button" className="pill" onClick={sendFriendRequest} disabled={!walletReady || socialLoading || !!friendActionKey || !friendWallet.trim()} style={actionBtn}>
                    {friendActionKey.startsWith("send:") ? "Sending..." : "Send request"}
                  </button>
                </div>
                {socialMessage ? <div className="small" style={{ marginTop: 10 }}>{socialMessage}</div> : null}

                <div style={socialGrid}>
                  <SocialRequestColumn
                    title="Incoming requests"
                    emptyText={walletReady ? "No incoming requests." : "Connect wallet to manage requests."}
                    items={social.incomingRequests}
                    loading={socialLoading}
                    renderActions={(entry) => (
                      <>
                        <button type="button" className="pill" onClick={() => runFriendAction(`accept:${entry.requestId}`, `/api/users/${address}/friend-requests/${entry.requestId}/accept`, "Friend request accepted.")} disabled={!!friendActionKey} style={actionBtnCompact}>
                          {friendActionKey === `accept:${entry.requestId}` ? "Accepting..." : "Accept"}
                        </button>
                        <button type="button" className="pill" onClick={() => runFriendAction(`reject:${entry.requestId}`, `/api/users/${address}/friend-requests/${entry.requestId}/reject`, "Friend request declined.")} disabled={!!friendActionKey} style={actionBtnCompact}>
                          {friendActionKey === `reject:${entry.requestId}` ? "Declining..." : "Decline"}
                        </button>
                      </>
                    )}
                  />

                  <SocialRequestColumn
                    title="Outgoing requests"
                    emptyText={walletReady ? "No outgoing requests." : "Connect wallet to manage requests."}
                    items={social.outgoingRequests}
                    loading={socialLoading}
                    renderActions={(entry) => (
                      <button type="button" className="pill" onClick={() => runFriendAction(`cancel:${entry.requestId}`, `/api/users/${address}/friend-requests/${entry.requestId}/cancel`, "Friend request cancelled.")} disabled={!!friendActionKey} style={actionBtnCompact}>
                        {friendActionKey === `cancel:${entry.requestId}` ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="card" style={{ gridColumn: "span 12" }}>
              <div className="accent cyan" />
              <div className="card-inner">
                <div className="section-title">Friends <span className="hint">accepted connections</span></div>
                {socialMessage ? <div className="small" style={{ marginTop: 10 }}>{socialMessage}</div> : null}
                <SocialFriendsPanel friends={social.friends} loading={socialLoading} removeFriend={removeFriend} friendActionKey={friendActionKey} />
              </div>
            </div>
          </>
        ) : null}

        {activeSection === "groups" ? (
          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="accent green" />
            <div className="card-inner">
              <div className="section-title">Groups <span className="hint">member circles + invites</span></div>
              <div className="small" style={{ marginTop: 8 }}>A group can contain people who are not all friends with each other. Only the owner invites members.</div>

              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} disabled={!walletReady || groupCreating} placeholder={walletReady ? "Group name" : "Connect wallet to create a group"} style={textInput} />
                <input value={newGroupDescription} onChange={(e) => setNewGroupDescription(e.target.value)} disabled={!walletReady || groupCreating} placeholder={walletReady ? "Short group description" : "Connect wallet to create a group"} style={textInput} />
                <div>
                  <button type="button" className="pill" onClick={createGroup} disabled={!walletReady || groupCreating || !newGroupName.trim()} style={actionBtn}>
                    {groupCreating ? "Creating..." : "Create group"}
                  </button>
                </div>
              </div>

              {socialMessage ? <div className="small" style={{ marginTop: 10 }}>{socialMessage}</div> : null}

              <div style={socialGrid}>
                <div className="shop-item">
                  <div style={columnTitle}>Pending group invites</div>
                  {socialLoading && social.pendingGroupInvites.length === 0 ? (
                    <div className="small" style={{ marginTop: 12 }}>Loading invites...</div>
                  ) : social.pendingGroupInvites.length === 0 ? (
                    <div className="small" style={{ marginTop: 12 }}>{walletReady ? "No pending group invites." : "Connect wallet to view invites."}</div>
                  ) : (
                    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                      {social.pendingGroupInvites.map((invite) => (
                        <div key={invite.inviteId} style={miniCard}>
                          <div style={{ fontWeight: 900 }}>{invite.groupName}</div>
                          <div className="small" style={{ marginTop: 4 }}>{invite.groupDescription || "No description yet."}</div>
                          <div className="small" style={{ marginTop: 6 }}>
                            Invited by {communityName(invite.inviter?.customDisplayName, invite.inviter?.walletAddress)}
                          </div>
                          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                            <button type="button" className="pill" onClick={() => runGroupInviteAction(`accept-group:${invite.inviteId}`, `/api/groups/${invite.groupId}/invites/${invite.inviteId}/accept`, "Group invite accepted.")} disabled={!!groupActionKey} style={actionBtnCompact}>
                              {groupActionKey === `accept-group:${invite.inviteId}` ? "Accepting..." : "Accept"}
                            </button>
                            <button type="button" className="pill" onClick={() => runGroupInviteAction(`decline-group:${invite.inviteId}`, `/api/groups/${invite.groupId}/invites/${invite.inviteId}/decline`, "Group invite declined.")} disabled={!!groupActionKey} style={actionBtnCompact}>
                              {groupActionKey === `decline-group:${invite.inviteId}` ? "Declining..." : "Decline"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="shop-item" style={{ gridColumn: "span 2" }}>
                  <div style={columnTitle}>Your groups</div>
                  {socialLoading && social.groups.length === 0 ? (
                    <div className="small" style={{ marginTop: 12 }}>Loading groups...</div>
                  ) : social.groups.length === 0 ? (
                    <div className="small" style={{ marginTop: 12 }}>{walletReady ? "You are not in any group yet." : "Connect wallet to view your groups."}</div>
                  ) : (
                    <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
                      {social.groups.map((group) => (
                        <div key={group.id} style={groupCard}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                            <div>
                              <div style={{ fontWeight: 900, fontSize: 18 }}>{group.name}</div>
                              <div className="small" style={{ marginTop: 4 }}>{group.description || "No description yet."}</div>
                            </div>
                            <div className="small">{group.viewerRole === "owner" ? "Owner" : "Member"} · Score {fmt(group.score?.score, 1)}</div>
                          </div>

                          <div style={{ marginTop: 14, ...miniCard }}>
                            <div style={{ fontWeight: 900 }}>Global crown milestone</div>
                            <div className="small" style={{ marginTop: 6 }}>
                              {fmt(group.globalMilestone?.progressKm, 1)} / {fmt(group.globalMilestone?.targetKm, 0)} km · reward: {group.globalMilestone?.rewardItemName || "Reward Crown"}
                            </div>
                            <div style={{ marginTop: 10, height: 10, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                              <div
                                style={{
                                  width: `${Math.min(100, (Number(group.globalMilestone?.progressKm || 0) / Math.max(1, Number(group.globalMilestone?.targetKm || 0))) * 100)}%`,
                                  height: "100%",
                                  background: group.globalMilestone?.unlocked
                                    ? "linear-gradient(90deg, rgba(251,191,36,.98), rgba(245,158,11,.92))"
                                    : "linear-gradient(90deg, rgba(34,211,238,.9), rgba(16,185,129,.92))",
                                }}
                              />
                            </div>
                            <div className="small" style={{ marginTop: 8 }}>
                              {group.globalMilestone?.unlocked
                                ? `Unlocked · granted to ${fmt(group.globalMilestone?.grantedCount, 0)} members`
                                : "Reach 2000 km together to unlock the crown for current members."}
                            </div>
                          </div>

                          <div style={{ marginTop: 10 }}>
                            {group.viewerRewardState?.canClaimCrown ? (
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                {group.viewerRewardState?.crownClaimed ? (
                                  <div className="small">Crown already owned. Reclaim if you need to resync it.</div>
                                ) : null}
                                <button
                                  type="button"
                                  className="pill"
                                  onClick={() => claimGroupCrown(group.id)}
                                  disabled={groupActionKey === `claim-crown:${group.id}`}
                                  style={actionBtnCompact}
                                >
                                  {groupActionKey === `claim-crown:${group.id}`
                                    ? "Claiming..."
                                    : group.viewerRewardState?.crownClaimed
                                    ? "Reclaim crown"
                                    : "Claim crown"}
                                </button>
                              </div>
                            ) : null}
                          </div>

                          <div style={{ marginTop: 14, ...miniCard }}>
                            <div style={{ fontWeight: 900 }}>Group challenge</div>
                            {group.activeChallenge ? (
                              <>
                                <div className="small" style={{ marginTop: 6 }}>
                                  {group.activeChallenge.title} · {fmt(group.activeChallenge.progressKm, 1)} / {fmt(group.activeChallenge.targetKm, 1)} km
                                </div>
                                <div className="small" style={{ marginTop: 6 }}>
                                  {formatDateRange(group.activeChallenge.startsAt, group.activeChallenge.endsAt)} · bonus {fmt(group.activeChallenge.bonusPoints, 1)} pts
                                </div>
                                <div style={{ marginTop: 10, height: 10, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                                  <div
                                    style={{
                                      width: `${Math.min(100, (Number(group.activeChallenge.progressKm || 0) / Math.max(1, Number(group.activeChallenge.targetKm || 0))) * 100)}%`,
                                      height: "100%",
                                      background: "linear-gradient(90deg, rgba(34,211,238,.9), rgba(16,185,129,.92))",
                                    }}
                                  />
                                </div>
                              </>
                            ) : (
                              <div className="small" style={{ marginTop: 6 }}>No active challenge yet.</div>
                            )}

                            {group.permissions?.canManageChallenge ? (
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                                <input
                                  value={groupChallengeDrafts[group.id]?.title || ""}
                                  onChange={(e) =>
                                    setGroupChallengeDrafts((prev) => ({
                                      ...prev,
                                      [group.id]: { ...(prev[group.id] || {}), title: e.target.value },
                                    }))
                                  }
                                  placeholder="Challenge title"
                                  style={textInput}
                                />
                                <input
                                  value={groupChallengeDrafts[group.id]?.targetKm || ""}
                                  onChange={(e) =>
                                    setGroupChallengeDrafts((prev) => ({
                                      ...prev,
                                      [group.id]: { ...(prev[group.id] || {}), targetKm: e.target.value },
                                    }))
                                  }
                                  placeholder="Target km"
                                  style={textInput}
                                />
                                <input
                                  type="datetime-local"
                                  value={groupChallengeDrafts[group.id]?.startsAt || getDefaultChallengeStart()}
                                  onChange={(e) =>
                                    setGroupChallengeDrafts((prev) => ({
                                      ...prev,
                                      [group.id]: { ...(prev[group.id] || {}), startsAt: e.target.value },
                                    }))
                                  }
                                  style={textInput}
                                />
                                <input
                                  type="datetime-local"
                                  value={groupChallengeDrafts[group.id]?.endsAt || getDefaultChallengeEnd()}
                                  onChange={(e) =>
                                    setGroupChallengeDrafts((prev) => ({
                                      ...prev,
                                      [group.id]: { ...(prev[group.id] || {}), endsAt: e.target.value },
                                    }))
                                  }
                                  style={textInput}
                                />
                                <button
                                  type="button"
                                  className="pill"
                                  onClick={() => saveGroupChallenge(group.id)}
                                  disabled={groupActionKey === `challenge:${group.id}`}
                                  style={actionBtnCompact}
                                >
                                  {groupActionKey === `challenge:${group.id}` ? "Saving..." : "Save challenge"}
                                </button>
                              </div>
                            ) : null}
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
                            {group.members.map((member) => (
                              <Link key={`${group.id}-${member.walletAddress}`} href={`/community/${member.walletAddress}`} style={{ textDecoration: "none", color: "inherit" }}>
                                <div style={memberChip}>
                                  <AvatarShowcase layout={member.avatar?.layout} size={84} rounded={16} />
                                  <div>
                                    <div style={{ fontWeight: 800 }}>{communityName(member.customDisplayName, member.walletAddress)}</div>
                                    <div className="mono" style={{ marginTop: 4 }}>{shortAddr(member.walletAddress)}</div>
                                    <div className="small" style={{ marginTop: 4 }}>{member.memberRole}</div>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                                      {group.permissions?.canManageAdmins && member.memberRole !== "owner" ? (
                                        <button
                                          type="button"
                                          className="pill"
                                          onClick={() => updateGroupRole(group.id, member.walletAddress, member.memberRole === "admin" ? "member" : "admin")}
                                          disabled={groupActionKey === `role:${group.id}:${member.walletAddress}:${member.memberRole === "admin" ? "member" : "admin"}`}
                                          style={actionBtnCompact}
                                        >
                                          {member.memberRole === "admin" ? "Remove admin" : "Make admin"}
                                        </button>
                                      ) : null}
                                      {(group.viewerRole === "owner" || (group.viewerRole === "admin" && member.memberRole === "member")) && member.memberRole !== "owner" ? (
                                        <button
                                          type="button"
                                          className="pill"
                                          onClick={() => removeGroupMember(group.id, member.walletAddress)}
                                          disabled={groupActionKey === `kick:${group.id}:${member.walletAddress}`}
                                          style={actionBtnCompact}
                                        >
                                          {groupActionKey === `kick:${group.id}:${member.walletAddress}` ? "Removing..." : "Kick"}
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>

                          {group.permissions?.canInviteMembers ? (
                            <div style={{ marginTop: 14 }}>
                              <div className="small">Invite wallet</div>
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                                <input value={groupInviteWallets[group.id] || ""} onChange={(e) => setGroupInviteWallets((prev) => ({ ...prev, [group.id]: e.target.value }))} disabled={!!groupActionKey} placeholder="Friend wallet or username" style={textInput} />
                                <button type="button" className="pill" onClick={() => inviteToGroup(group.id)} disabled={!!groupActionKey || !String(groupInviteWallets[group.id] || "").trim()} style={actionBtn}>
                                  {groupActionKey.startsWith(`invite:${group.id}:`) ? "Inviting..." : "Invite"}
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {group.permissions?.canDeleteGroup ? (
                            <div style={{ marginTop: 14 }}>
                              <div className="small">Owner controls</div>
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                                {confirmDeleteGroupId === group.id ? (
                                  <>
                                    <button type="button" className="pill" onClick={() => deleteGroup(group.id)} disabled={groupActionKey === `delete:${group.id}`} style={actionBtnCompact}>
                                      {groupActionKey === `delete:${group.id}` ? "Deleting..." : "Confirm delete"}
                                    </button>
                                    <button type="button" className="pill" onClick={() => setConfirmDeleteGroupId(null)} style={actionBtnCompact}>
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button type="button" className="pill" onClick={() => setConfirmDeleteGroupId(group.id)} style={actionBtnCompact}>
                                    Delete group
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : null}

                          {group.viewerRole && group.viewerRole !== "owner" ? (
                            <div style={{ marginTop: 14 }}>
                              <div className="small">Membership</div>
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                                <button
                                  type="button"
                                  className="pill"
                                  onClick={() => leaveGroup(group.id)}
                                  disabled={groupActionKey === `leave:${group.id}`}
                                  style={actionBtnCompact}
                                >
                                  {groupActionKey === `leave:${group.id}` ? "Leaving..." : "Leave group"}
                                </button>
                              </div>
                            </div>
                          ) : null}

                          <div style={{ marginTop: 14 }}>
                            <div className="small">Group chat</div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                              <Link href={`/chat?group=${group.id}`} className="pill" style={linkBtn}>
                                Open group chat
                              </Link>
                            </div>
                          </div>

                          <div style={{ marginTop: 14 }}>
                            <div className="small">Group leaderboard</div>
                            <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                              {[...(group.members || [])]
                                .sort((a, b) => Number(b?.rewards?.breakdown?.distanceKm || 0) - Number(a?.rewards?.breakdown?.distanceKm || 0))
                                .slice(0, 5)
                                .map((member, index) => (
                                  <Link
                                    key={`${group.id}-leader-${member.walletAddress}`}
                                    href={`/community/${member.walletAddress}`}
                                    style={{ textDecoration: "none", color: "inherit" }}
                                  >
                                    <div style={leaderRow}>
                                      <div style={{ fontWeight: 900, minWidth: 34 }}>#{index + 1}</div>
                                      <AvatarShowcase layout={member.avatar?.layout} size={56} rounded={14} />
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 800 }}>{communityName(member.customDisplayName, member.walletAddress)}</div>
                                        <div className="small" style={{ marginTop: 4 }}>
                                          {fmt(member.rewards?.breakdown?.distanceKm, 2)} km · {fmt(member.rewards?.eventsCount, 0)} trips
                                        </div>
                                      </div>
                                    </div>
                                  </Link>
                                ))}
                            </div>
                          </div>

                          {group.pendingInvites?.length ? (
                            <div style={{ marginTop: 12 }}>
                              <div className="small">Pending invites</div>
                              <div className="small" style={{ marginTop: 4 }}>
                                {group.pendingInvites.map((invite) => communityName(invite.customDisplayName, invite.walletAddress)).join(", ")}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeSection === "leaderboard" ? (
          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="accent cyan" />
            <div className="card-inner">
              <div className="section-title">Leaderboard <span className="hint">avatar cards</span></div>
              {loading && top.length === 0 ? (
                <div className="small">Loading community cards...</div>
              ) : top.length === 0 ? (
                <div className="small">No community data yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 18, marginTop: 14 }}>
                  <div>
                    <div className="small" style={{ marginBottom: 10 }}>Rider leaderboard</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
                      {top.map((entry, index) => {
                        const publicName = communityName(entry.customDisplayName, entry.walletAddress);
                        return (
                          <Link key={`${entry.walletAddress}-${index}`} href={`/community/${entry.walletAddress}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                            <div className="shop-item leaderboard-card" style={{ height: "100%" }}>
                              <div style={{ position: "relative" }}>
                                <AvatarShowcase layout={entry.avatar?.layout} size={220} rounded={20} />
                                <div className={`rank-badge rank-badge--${index < 3 ? ["gold","silver","bronze"][index] : "default"}`}>
                                  #{index + 1}
                                </div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 14 }}>
                                <div>
                                  <div style={{ fontWeight: 800, marginTop: 4, lineHeight: 1.15 }}>{publicName}</div>
                                  <div className="mono">{shortAddr(entry.walletAddress)}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontWeight: 900 }}>{fmt(entry.distanceKm, 2)} km</div>
                                  <div className="small">{fmt(entry.trips, 0)} trips</div>
                                </div>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="small" style={{ marginBottom: 10 }}>Group leaderboard by score</div>
                    {groupLeaderboard.length === 0 ? (
                      <div className="small">No groups ranked yet.</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
                        {groupLeaderboard.map((group) => (
                          <div key={group.id} className="shop-item">
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div>
                                <div style={{ fontWeight: 900 }}>#{group.rank}</div>
                                <div style={{ fontWeight: 800, marginTop: 4 }}>{group.name}</div>
                                <div className="small">{fmt(group.memberCount, 0)} members</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontWeight: 900 }}>{fmt(group.score?.score, 1)} pts</div>
                                <div className="small">{fmt(group.score?.totalDistanceKm, 1)} km</div>
                              </div>
                            </div>
                            <div className="small" style={{ marginTop: 8 }}>
                              Challenge bonus: {fmt(group.score?.challengeScore, 1)} · Completed: {fmt(group.score?.completedChallenges, 0)}
                            </div>
                            <div className="small" style={{ marginTop: 4 }}>
                              {group.globalMilestone?.unlocked ? "Crown milestone unlocked" : "Crown milestone in progress"}
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                              {(group.topMembers || []).map((member) => (
                                <Link
                                  key={`${group.id}-${member.walletAddress}`}
                                  href={`/community/${member.walletAddress}`}
                                  style={{ textDecoration: "none", color: "inherit" }}
                                >
                                  <AvatarShowcase layout={member.avatar?.layout} size={58} rounded={14} />
                                </Link>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SummaryMini({ title, value, hint }) {
  return (
    <div className="community-summary-tile" style={summaryMini}>
      <div className="small">{title}</div>
      <div style={{ fontWeight: 900, fontSize: 24, marginTop: 4 }}>{value}</div>
      <div className="small" style={{ marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function formatDateRange(startsAt, endsAt) {
  if (!startsAt || !endsAt) return "No schedule";
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "No schedule";
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

function SocialRequestColumn({ title, emptyText, items, loading, renderActions }) {
  return (
    <div className="shop-item">
      <div style={columnTitle}>{title}</div>
      {loading && items.length === 0 ? (
        <div className="small" style={{ marginTop: 12 }}>Loading...</div>
      ) : items.length === 0 ? (
        <div className="small" style={{ marginTop: 12 }}>{emptyText}</div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {items.map((entry) => (
            <div key={entry.requestId} style={miniCard}>
              <div style={{ fontWeight: 800 }}>{communityName(entry.customDisplayName, entry.walletAddress)}</div>
              <div className="mono" style={{ marginTop: 4 }}>{shortAddr(entry.walletAddress)}</div>
              <div className="small" style={{ marginTop: 6 }}>{fmt(entry.rewards?.breakdown?.distanceKm, 2)} km</div>
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>{renderActions(entry)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SocialFriendsPanel({ friends, loading, removeFriend, friendActionKey }) {
  if (loading && friends.length === 0) {
    return <div className="small" style={{ marginTop: 12 }}>Loading friends...</div>;
  }
  if (friends.length === 0) {
    return <div className="small" style={{ marginTop: 12 }}>No accepted friends yet.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
      {friends.map((friend) => (
        <div key={friend.walletAddress} style={miniCard}>
          <div style={memberChip}>
            <Link href={`/community/${friend.walletAddress}`} style={{ textDecoration: "none", color: "inherit" }}>
              <AvatarShowcase layout={friend.avatar?.layout} size={84} rounded={16} />
            </Link>
            <div>
              <Link href={`/community/${friend.walletAddress}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ fontWeight: 800 }}>{communityName(friend.customDisplayName, friend.walletAddress)}</div>
              </Link>
              <div className="mono" style={{ marginTop: 4 }}>{shortAddr(friend.walletAddress)}</div>
              <div className="small" style={{ marginTop: 6 }}>
                {fmt(friend.rewards?.breakdown?.distanceKm, 2)} km | {fmt(friend.rewards?.eventsCount, 0)} events
              </div>
              <div className="small" style={{ marginTop: 4 }}>{formatLastActive(friend.presence)}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <Link href={`/community/${friend.walletAddress}`} className="pill" style={linkBtn}>
                  View profile
                </Link>
                <Link href={`/chat?with=${friend.walletAddress}`} className="pill" style={linkBtn}>
                  Chat
                </Link>
                <button
                  type="button"
                  className="pill"
                  onClick={() => removeFriend(friend.walletAddress)}
                  disabled={friendActionKey === `remove:${friend.walletAddress}`}
                  style={actionBtnCompact}
                >
                  {friendActionKey === `remove:${friend.walletAddress}` ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CommunityPage() {
  return (
    <Suspense>
      <CommunityPageInner />
    </Suspense>
  );
}

const textInput = {
  minWidth: 260,
  flex: "1 1 320px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(255,255,255,.06)",
  color: "rgba(255,255,255,.96)",
  padding: "12px 14px",
  outline: "none",
};

const actionBtn = {
  cursor: "pointer",
  minWidth: 120,
};

const actionBtnCompact = {
  cursor: "pointer",
};

const linkBtn = {
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const summaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: 12,
  marginTop: 14,
};

const summaryMini = {
  borderRadius: 14,
  padding: 12,
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.03)",
};

const sectionTabs = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginTop: 16,
};

const tabBtn = {
  cursor: "pointer",
  opacity: 0.92,
  border: "1px solid rgba(255,255,255,.10)",
  background: "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
  minWidth: 120,
  fontWeight: 800,
};

const activeTabBtn = {
  cursor: "pointer",
  opacity: 1,
  border: "1px solid rgba(34,211,238,.45)",
  background: "linear-gradient(180deg, rgba(34,211,238,.22), rgba(16,185,129,.14))",
  boxShadow: "0 10px 30px rgba(34,211,238,.12)",
  minWidth: 120,
  fontWeight: 900,
};

const socialGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 16,
  marginTop: 16,
};

const columnTitle = {
  fontWeight: 900,
  fontSize: 18,
};

const miniCard = {
  borderRadius: 14,
  padding: 12,
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.03)",
};

const groupCard = {
  borderRadius: 18,
  padding: 16,
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.03)",
};

const memberChip = {
  display: "grid",
  gridTemplateColumns: "84px 1fr",
  gap: 10,
  alignItems: "center",
  padding: 10,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.02)",
};

const leaderRow = {
  display: "grid",
  gridTemplateColumns: "34px 56px 1fr",
  gap: 10,
  alignItems: "center",
  padding: 10,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.03)",
};
