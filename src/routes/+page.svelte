<script lang="ts">
	import { browser } from "$app/environment";
	import { afterUpdate, onDestroy, onMount } from "svelte";
	import { tick } from "svelte";
	import type { RealtimeChannel } from "@supabase/supabase-js";
	import { renderMarkdown } from "$lib/markdown";
	import { hasSupabaseConfig, supabase } from "$lib/supabase";
	import {
		Send,
		Bold,
		Italic,
		Link,
		Paperclip,
		X,
		Highlighter,
	} from "lucide-svelte";

	type DatabaseMessage = {
		id: number;
		content: string;
		created_at: string;
		sender_id: string;
		is_pinned?: boolean;
	};

	type UiMessage = {
		id: string;
		content: string;
		createdAt: string;
		senderId: string;
		safeHtml: string;
		isPinned: boolean;
	};

	type BroadcastMessage = {
		id?: string;
		content: string;
		createdAt: string;
		senderId: string;
		isPinned?: boolean;
		type?: "message" | "pin_toggle" | "delete";
	};

	let isAdmin = false;

	const sessionKey = "chatboard_session_user";

	const resolveSessionUserId = () => {
		if (!browser) {
			return "server";
		}

		const existing = sessionStorage.getItem(sessionKey);
		if (existing) {
			return existing;
		}

		const generated = crypto.randomUUID();
		sessionStorage.setItem(sessionKey, generated);
		return generated;
	};

	const sessionUserId = resolveSessionUserId();

	let messages: UiMessage[] = [];
	let draft = "";
	let loading = true;
	let error = "";
	let sending = false;
	let isRealtimeReady = false;
	let isConnectingRealtime = false;
	let realtimeWarning = "";
	let messagesContainer: HTMLDivElement | null = null;
	let messagesEndAnchor: HTMLDivElement | null = null;
	let composer: HTMLTextAreaElement | null = null;
	let resizeRafId: number | null = null;
	const seenMessageIds = new Set<string>();
	let pendingAutoScroll = false;
	let lastDraftValue = "";

	let isPinDropdownOpen = false;
	$: pinnedMessages = messages.filter((m) => m.isPinned);

	let contextMenu = {
		visible: false,
		x: 0,
		y: 0,
		message: null as UiMessage | null,
	};

	const maxComposerHeight = 176;
	const minComposerHeight = 44;
	const nearBottomThreshold = 72;

	let channel: RealtimeChannel | null = null;

	const scrollMessagesToBottom = () => {
		if (!messagesContainer) {
			return;
		}

		messagesContainer.scrollTop = messagesContainer.scrollHeight;
		messagesEndAnchor?.scrollIntoView({ block: "end" });
	};

	const requestAutoScroll = () => {
		pendingAutoScroll = true;
	};

	const isNearBottom = () => {
		if (!messagesContainer) {
			return true;
		}

		const distanceFromBottom =
			messagesContainer.scrollHeight -
			messagesContainer.scrollTop -
			messagesContainer.clientHeight;
		return distanceFromBottom <= nearBottomThreshold;
	};

	const resizeComposer = () => {
		if (!composer) {
			return;
		}

		composer.style.height = "0px";
		const nextHeight = Math.min(
			Math.max(composer.scrollHeight, minComposerHeight),
			maxComposerHeight,
		);
		composer.style.height = `${nextHeight}px`;
		composer.style.overflowY =
			composer.scrollHeight > maxComposerHeight ? "auto" : "hidden";
		composer.scrollTop = composer.scrollHeight;
	};

	const resetComposerSize = () => {
		if (!composer) {
			return;
		}

		composer.style.height = `${minComposerHeight}px`;
		composer.style.overflowY = "hidden";
		composer.scrollTop = 0;
	};

	const scheduleComposerResize = () => {
		if (resizeRafId !== null) {
			cancelAnimationFrame(resizeRafId);
		}

		resizeRafId = requestAnimationFrame(() => {
			resizeComposer();
			resizeRafId = null;
		});
	};

	const reconnectRealtime = async () => {
		realtimeWarning = "";
		error = "";
		await connectRealtime();
	};

	const toUiMessage = (message: {
		id: string;
		content: string;
		createdAt: string;
		senderId: string;
		isPinned?: boolean;
	}): UiMessage => {
		return {
			id: message.id,
			content: message.content,
			createdAt: message.createdAt,
			senderId: message.senderId,
			safeHtml: renderMarkdown(message.content),
			isPinned: !!message.isPinned,
		};
	};

	const appendMessage = (message: UiMessage) => {
		if (seenMessageIds.has(message.id)) {
			return;
		}

		seenMessageIds.add(message.id);
		if (seenMessageIds.size > 120) {
			const overflow = seenMessageIds.size - 120;
			let removed = 0;
			for (const id of seenMessageIds) {
				seenMessageIds.delete(id);
				removed += 1;
				if (removed >= overflow) {
					break;
				}
			}
		}

		const shouldStickToBottom = isNearBottom();
		messages =
			messages.length >= 40
				? [...messages.slice(-39), message]
				: [...messages, message];
		if (message.senderId === sessionUserId || shouldStickToBottom) {
			requestAutoScroll();
		}
	};

	const loadMessages = async () => {
		if (!supabase) {
			loading = false;
			return;
		}

		const { data, error: loadError } = await supabase
			.from("chat_messages")
			.select("id, content, created_at, sender_id, is_pinned")
			.order("created_at", { ascending: false })
			.order("id", { ascending: false })
			.limit(40);

		if (loadError) {
			error = loadError.message;
			loading = false;
			return;
		}

		messages = (data as DatabaseMessage[]).reverse().map((entry) =>
			toUiMessage({
				id: String(entry.id),
				content: entry.content,
				createdAt: entry.created_at,
				senderId: entry.sender_id,
				isPinned: entry.is_pinned,
			}),
		);

		seenMessageIds.clear();
		for (const message of messages) {
			seenMessageIds.add(message.id);
		}

		loading = false;
		requestAutoScroll();
	};

	const connectRealtime = async () => {
		if (!supabase) {
			return;
		}

		if (channel) {
			void supabase.removeChannel(channel);
			channel = null;
		}

		isConnectingRealtime = true;

		channel = supabase
			.channel("chatboard-room", {
				config: {
					broadcast: {
						self: true,
					},
				},
			})
			.on("broadcast", { event: "message" }, ({ payload }) => {
				const incoming = payload as BroadcastMessage;

				if (incoming.type === "pin_toggle") {
					messages = messages.map((m) =>
						m.id === incoming.id
							? { ...m, isPinned: !!incoming.isPinned }
							: m,
					);
					return;
				}

				if (incoming.type === "delete") {
					messages = messages.filter((m) => m.id !== incoming.id);
					return;
				}

				appendMessage(
					toUiMessage({
						id: incoming.id ?? crypto.randomUUID(),
						content: incoming.content,
						createdAt: incoming.createdAt,
						senderId: incoming.senderId,
						isPinned: incoming.isPinned,
					}),
				);
			});

		channel.subscribe((status) => {
			if (status === "SUBSCRIBED") {
				isRealtimeReady = true;
				isConnectingRealtime = false;
				realtimeWarning = "";
				return;
			}

			isRealtimeReady = false;
			isConnectingRealtime = false;
			if (
				status === "CHANNEL_ERROR" ||
				status === "TIMED_OUT" ||
				status === "CLOSED"
			) {
				realtimeWarning = "Realtime channel is not connected.";
			}
		});
	};

	const submitMessage = async () => {
		const content = draft.trim();
		if (!content || !supabase || !channel || !isRealtimeReady) {
			if (!isRealtimeReady) {
				realtimeWarning = "Realtime channel is not connected.";
			}
			return;
		}

		sending = true;
		error = "";

		const payload: BroadcastMessage = {
			id: crypto.randomUUID(),
			content,
			createdAt: new Date().toISOString(),
			senderId: sessionUserId,
		};

		const broadcastError = await channel.send({
			type: "broadcast",
			event: "message",
			payload,
		});

		if (broadcastError !== "ok") {
			realtimeWarning = `Realtime send failed (${broadcastError}).`;
			sending = false;
			return;
		}

		void supabase
			.from("chat_messages")
			.insert({
				content,
				created_at: payload.createdAt,
				sender_id: payload.senderId,
				is_pinned: false,
			})
			.then(({ error: insertError }) => {
				if (insertError) {
					error = `Message broadcasted but database insert failed: ${insertError.message}`;
				}
			});

		draft = "";
		sending = false;
		await tick();
		resetComposerSize();
		requestAutoScroll();
	};

	const togglePin = async (message: UiMessage) => {
		if (!supabase || !channel) return;
		const newPinState = !message.isPinned;

		messages = messages.map((m) =>
			m.id === message.id ? { ...m, isPinned: newPinState } : m,
		);

		void channel.send({
			type: "broadcast",
			event: "message",
			payload: {
				id: message.id,
				isPinned: newPinState,
				type: "pin_toggle",
				content: "",
				createdAt: "",
				senderId: "",
			} as BroadcastMessage,
		});

		void supabase
			.from("chat_messages")
			.update({ is_pinned: newPinState })
			.eq("id", Number(message.id));
	};

	const deleteMessage = async (id: string) => {
		if (!supabase || !channel || !isAdmin) return;

		messages = messages.filter((m) => m.id !== id);

		void channel.send({
			type: "broadcast",
			event: "message",
			payload: {
				id,
				type: "delete",
				content: "",
				createdAt: "",
				senderId: "",
			} as BroadcastMessage,
		});

		void supabase.from("chat_messages").delete().eq("id", Number(id));
	};

	const scrollToMessage = (id: string) => {
		const el = document.getElementById(`msg-${id}`);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			el.classList.add("highlight-pulse");
			setTimeout(() => {
				el.classList.remove("highlight-pulse");
			}, 2000);
		}
		isPinDropdownOpen = false;
	};

	const copyMessage = async (content: string) => {
		try {
			await navigator.clipboard.writeText(content);
		} catch {
			error = "Failed to copy message.";
		}
	};

	const isTextInputContext = (element: Element | null) => {
		if (!(element instanceof HTMLElement)) {
			return false;
		}

		const tagName = element.tagName.toLowerCase();
		if (tagName === "textarea" || tagName === "select") {
			return true;
		}

		if (tagName === "input") {
			const input = element as HTMLInputElement;
			const textTypes = new Set([
				"text",
				"search",
				"email",
				"url",
				"password",
				"tel",
				"number",
			]);
			return textTypes.has((input.type || "text").toLowerCase());
		}

		return element.isContentEditable;
	};

	const focusComposer = () => {
		if (!composer) {
			return;
		}

		composer.focus();
		const end = composer.value.length;
		composer.setSelectionRange(end, end);
	};

	const handleGlobalKeydown = (event: KeyboardEvent) => {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}

		if (isTextInputContext(document.activeElement)) {
			return;
		}

		const key = event.key.toLowerCase();
		if (event.key === "Enter" || key === "t") {
			event.preventDefault();
			focusComposer();
		}
	};

	const insertMarkdown = (prefix: string, suffix: string = "") => {
		if (!composer) return;

		const start = composer.selectionStart;
		const end = composer.selectionEnd;
		const text = draft;
		const selectedText = text.substring(start, end);

		const before = text.substring(0, start);
		const after = text.substring(end);

		draft = before + prefix + selectedText + suffix + after;

		// Wait for DOM update, then restore selection inside the new markdown tags
		tick().then(() => {
			if (composer) {
				composer.focus();
				const newCursorPos =
					selectedText.length > 0
						? start +
							prefix.length +
							selectedText.length +
							suffix.length
						: start + prefix.length;
				composer.setSelectionRange(newCursorPos, newCursorPos);
				scheduleComposerResize();
			}
		});
	};

	onMount(async () => {
		isAdmin = sessionStorage.getItem("chatboard_is_admin") === "true";
		resetComposerSize();
		window.addEventListener("keydown", handleGlobalKeydown);
		resizeComposer();
		await loadMessages();
		await connectRealtime();
	});

	afterUpdate(() => {
		if (draft !== lastDraftValue) {
			lastDraftValue = draft;
			scheduleComposerResize();
		}

		if (!pendingAutoScroll) {
			return;
		}

		pendingAutoScroll = false;
		requestAnimationFrame(() => {
			scrollMessagesToBottom();
		});
	});

	onDestroy(() => {
		window.removeEventListener("keydown", handleGlobalKeydown);

		if (resizeRafId !== null) {
			cancelAnimationFrame(resizeRafId);
		}

		if (channel && supabase) {
			isRealtimeReady = false;
			isConnectingRealtime = false;
			void supabase.removeChannel(channel);
		}
	});
</script>

<svelte:window
	onclick={() => {
		if (contextMenu.visible)
			contextMenu = { ...contextMenu, visible: false };
	}}
	onscroll={() => {
		if (contextMenu.visible)
			contextMenu = { ...contextMenu, visible: false };
	}}
/>

<div
	class="sketch-pattern flex h-[100dvh] flex-col overflow-hidden text-[#333333]"
>
	<header
		class="sketchy-border-bottom flex items-center justify-between bg-[#FAF9F6] px-6 py-4 shrink-0 mx-auto w-full max-w-6xl mt-4"
	>
		<h1 class="text-xl font-bold">Chatboard</h1>
		<a
			href={isAdmin ? "/admin" : "#"}
			class="sketchy-border bg-white px-4 py-2 text-sm font-medium hover:bg-[#FFFDE7]"
			onclick={(e) => {
				if (!isAdmin) {
					e.preventDefault();
					const pass = prompt("Enter Admin Password:");
					if (pass === "admin123") {
						sessionStorage.setItem("chatboard_is_admin", "true");
						isAdmin = true;
					} else if (pass !== null) {
						alert("Incorrect password.");
					}
				}
			}}>{isAdmin ? "Admin Dashboard" : "Admin Login"}</a
		>
	</header>

	<main
		class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-6 py-6 relative"
	>
		{#if pinnedMessages.length > 0 && !isPinDropdownOpen}
			<div
				class="absolute top-4 right-10 left-10 z-20 flex justify-center"
			>
				<button
					class="sketchy-border bg-[#FFFDE7] shadow-sm px-4 py-1.5 text-sm font-medium hover:bg-[#FAF9F6] flex items-center gap-2 rounded-full"
					onclick={() => (isPinDropdownOpen = true)}
				>
					📌 <span class="text-xs"
						>{pinnedMessages.length} Pinned</span
					>
				</button>
			</div>
		{/if}

		{#if isPinDropdownOpen}
			<div
				class="absolute top-4 right-10 left-10 z-30 flex justify-center"
			>
				<div
					class="sketchy-border bg-[#FFFDE7] p-2 shadow-lg max-h-60 overflow-y-auto w-full max-w-lg relative"
				>
					<button
						class="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full"
						onclick={() => (isPinDropdownOpen = false)}
					>
						<X size={16} />
					</button>
					<h3
						class="font-bold text-sm mb-2 px-2 border-b border-gray-200 pb-1"
					>
						Pinned Messages
					</h3>
					{#each pinnedMessages as pinned}
						<button
							class="block w-full text-left p-2 hover:bg-[#FAF9F6] sketchy-border-alt mb-2 text-sm truncate"
							onclick={() => scrollToMessage(pinned.id)}
						>
							{pinned.content.substring(0, 100)}{pinned.content
								.length > 100
								? "..."
								: ""}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if !hasSupabaseConfig}
			<section class="sketchy-border bg-[#FFFDE7] p-4 text-2xl">
				Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY to start
				realtime chat.
			</section>
		{:else}
			{#if isConnectingRealtime && !isRealtimeReady}
				<p
					class="mb-3 text-sm tracking-[0.25em] opacity-70"
					aria-label="Connecting"
				>
					...
				</p>
			{/if}
			{#if realtimeWarning}
				<blockquote class="realtime-warning mb-3">
					<p>{realtimeWarning}</p>
					<button
						type="button"
						class="retry-btn"
						onclick={() => {
							void reconnectRealtime();
						}}
					>
						Retry
					</button>
				</blockquote>
			{/if}
			<div
				class="chat-stream min-h-0 flex-1 space-y-6 overflow-y-auto pb-4 pr-3"
				bind:this={messagesContainer}
			>
				{#if loading}
					<p class="sketchy-border bg-[#FFFDE7] px-4 py-2 text-base">
						Loading messages…
					</p>
				{:else if messages.length === 0}
					<p class="sketchy-border bg-[#FFFDE7] px-4 py-2 text-base">
						No messages yet.
					</p>
				{:else}
					{#each messages as message (message.id)}
						<div
							id={`msg-${message.id}`}
							class={`message-row flex items-start gap-3 ${message.senderId === sessionUserId ? "is-own flex-row-reverse" : ""}`}
						>
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<article
								class={`message-shell message-copy-wrap cursor-context-menu ${message.senderId === sessionUserId ? "sketchy-border-alt" : "sketchy-border"} ${message.isPinned ? "ring-2 ring-[#FBC02D]" : ""} ${message.safeHtml.includes("<mark>") ? "is-highlighted" : ""}`}
								oncontextmenu={(e) => {
									e.preventDefault();
									// Adjust position so it doesn't immediately dismiss itself
									contextMenu = {
										visible: true,
										x: e.clientX,
										y: e.clientY,
										message: message,
									};
								}}
							>
								<div
									class="markdown-body"
									aria-label="chat message markdown output"
								>
									{@html message.safeHtml}
								</div>
							</article>
						</div>
					{/each}
				{/if}
				<div
					bind:this={messagesEndAnchor}
					aria-hidden="true"
					class="h-px w-full"
				></div>
			</div>
		{/if}

		{#if contextMenu.visible && contextMenu.message}
			<div
				class="fixed z-50 bg-white sketchy-border shadow-lg flex flex-col py-1 min-w-[140px]"
				style={`top: ${contextMenu.y}px; left: ${contextMenu.x}px;`}
			>
				<button
					class="text-left px-4 py-2 text-sm hover:bg-[#FFFDE7] transition-colors border-b border-gray-100"
					onclick={(e) => {
						if (contextMenu.message) {
							void togglePin(contextMenu.message);
						}
					}}
				>
					{contextMenu.message.isPinned
						? "📍 Unpin Message"
						: "📌 Pin Message"}
				</button>
				<button
					class="text-left px-4 py-2 text-sm hover:bg-[#FFFDE7] transition-colors"
					onclick={(e) => {
						if (contextMenu.message) {
							void copyMessage(contextMenu.message.content);
						}
					}}
				>
					📋 Copy Text
				</button>
				{#if isAdmin}
					<button
						class="text-left px-4 py-2 text-sm hover:bg-[#ffecec] transition-colors text-red-600 font-bold border-t border-gray-100 mt-1 pt-2"
						onclick={(e) => {
							if (contextMenu.message) {
								if (
									confirm("Permanently delete this message?")
								) {
									void deleteMessage(contextMenu.message.id);
									contextMenu = {
										...contextMenu,
										visible: false,
									};
								}
							}
						}}
					>
						🗑️ Delete Message
					</button>
				{/if}
			</div>
		{/if}
	</main>

	<footer
		class="sketchy-border-top sticky bottom-0 z-10 shrink-0 bg-[#FAF9F6] px-6 py-4"
	>
		<form
			class="mx-auto flex w-full max-w-6xl flex-col gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void submitMessage();
			}}
		>
			<div class="flex items-end gap-3 w-full">
				<button
					type="button"
					class="p-2 mb-1 opacity-50 hover:opacity-100 hover:bg-gray-200 rounded-full transition-colors"
					aria-label="Attach file"
				>
					<Paperclip size={20} />
				</button>

				<div
					class="input-shell sketchy-border flex-1 flex flex-col justify-end"
				>
					<div
						class="flex justify-between items-center mb-1 px-3 w-full border-b border-gray-100 pb-1 opacity-60"
					>
						<div class="flex gap-3 text-xs">
							<button
								type="button"
								class="flex items-center gap-1 cursor-pointer hover:text-black transition-colors"
								title="**bold**"
								onclick={() => insertMarkdown("**", "**")}
								><Bold size={14} /></button
							>
							<button
								type="button"
								class="flex items-center gap-1 cursor-pointer hover:text-black transition-colors"
								title="*italic*"
								onclick={() => insertMarkdown("*", "*")}
								><Italic size={14} /></button
							>
							<button
								type="button"
								class="flex items-center gap-1 cursor-pointer hover:text-black transition-colors"
								title="[link](url)"
								onclick={() => insertMarkdown("[", "](url)")}
								><Link size={14} /></button
							>
							<button
								type="button"
								class="flex items-center gap-1 cursor-pointer hover:text-black transition-colors"
								title="==highlight=="
								onclick={() => insertMarkdown("==", "==")}
								><Highlighter size={14} /></button
							>
						</div>
					</div>
					<textarea
						bind:this={composer}
						id="chat-input"
						bind:value={draft}
						rows="1"
						placeholder="Type your message..."
						class="w-full resize-none border-none bg-transparent px-3 py-2 text-lg leading-6 outline-none"
						oninput={scheduleComposerResize}
						onkeydown={(event) => {
							if (event.key === "Enter" && event.ctrlKey) {
								event.preventDefault();
								void submitMessage();
							}
						}}
					></textarea>
				</div>
				<button
					type="submit"
					disabled={sending ||
						!draft.trim() ||
						!isRealtimeReady ||
						!hasSupabaseConfig}
					class="send-shell sketchy-border-alt disabled:opacity-50"
					aria-label="Send message"
				>
					<Send size={18} />
				</button>
			</div>
		</form>
		{#if error}
			<p class="mx-auto mt-2 w-full max-w-6xl text-sm text-[#8b0000]">
				{error}
			</p>
		{/if}
	</footer>
</div>
