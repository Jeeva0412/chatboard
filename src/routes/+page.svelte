<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy, onMount } from 'svelte';
	import { tick } from 'svelte';
	import type { RealtimeChannel } from '@supabase/supabase-js';
	import { renderMarkdown } from '$lib/markdown';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';

	type DatabaseMessage = {
		id: number;
		content: string;
		created_at: string;
		sender_id: string;
	};

	type UiMessage = {
		id: string;
		content: string;
		createdAt: string;
		senderId: string;
		safeHtml: string;
	};

	type BroadcastMessage = {
		id?: string;
		content: string;
		createdAt: string;
		senderId: string;
	};

	const sessionKey = 'chatboard_session_user';

	const resolveSessionUserId = () => {
		if (!browser) {
			return 'server';
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
	let draft = '';
	let loading = true;
	let error = '';
	let sending = false;
	let isRealtimeReady = false;
	let messagesContainer: HTMLDivElement | null = null;
	let composer: HTMLTextAreaElement | null = null;

	const maxComposerHeight = 176;
	const nearBottomThreshold = 72;

	let channel: RealtimeChannel | null = null;

	const scrollMessagesToBottom = () => {
		if (!messagesContainer) {
			return;
		}

		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	};

	const isNearBottom = () => {
		if (!messagesContainer) {
			return true;
		}

		const distanceFromBottom =
			messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
		return distanceFromBottom <= nearBottomThreshold;
	};

	const resizeComposer = () => {
		if (!composer) {
			return;
		}

		composer.style.height = 'auto';
		const nextHeight = Math.min(composer.scrollHeight, maxComposerHeight);
		composer.style.height = `${nextHeight}px`;
		composer.style.overflowY = composer.scrollHeight > maxComposerHeight ? 'auto' : 'hidden';
	};

	const toUiMessage = (message: {
		id: string;
		content: string;
		createdAt: string;
		senderId: string;
	}): UiMessage => {
		return {
			id: message.id,
			content: message.content,
			createdAt: message.createdAt,
			senderId: message.senderId,
			safeHtml: renderMarkdown(message.content)
		};
	};

	const appendMessage = (message: UiMessage) => {
		const shouldStickToBottom = isNearBottom();
		messages = [...messages, message].slice(-40);
		if (shouldStickToBottom) {
			void tick().then(scrollMessagesToBottom);
		}
	};

	const loadMessages = async () => {
		if (!supabase) {
			loading = false;
			return;
		}

		const { data, error: loadError } = await supabase
			.from('chat_messages')
			.select('id, content, created_at, sender_id')
			.order('created_at', { ascending: true })
			.limit(40);

		if (loadError) {
			error = loadError.message;
			loading = false;
			return;
		}

		messages = (data as DatabaseMessage[]).map((entry) =>
			toUiMessage({
				id: String(entry.id),
				content: entry.content,
				createdAt: entry.created_at,
				senderId: entry.sender_id
			})
		);

		loading = false;
		await tick();
		scrollMessagesToBottom();
	};

	const connectRealtime = async () => {
		if (!supabase) {
			return;
		}

		channel = supabase
			.channel('chatboard-room', {
				config: {
					broadcast: {
						self: true
					}
				}
			})
			.on('broadcast', { event: 'message' }, ({ payload }) => {
				const incoming = payload as BroadcastMessage;
				appendMessage(
					toUiMessage({
						id: incoming.id ?? crypto.randomUUID(),
						content: incoming.content,
						createdAt: incoming.createdAt,
						senderId: incoming.senderId
					})
				);
			});

		channel.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				isRealtimeReady = true;
				return;
			}

			isRealtimeReady = false;
			if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
				error = 'Realtime channel could not connect.';
			}
		});
	};

	const submitMessage = async () => {
		const content = draft.trim();
		if (!content || !supabase || !channel || !isRealtimeReady) {
			return;
		}

		sending = true;
		error = '';

		const payload: BroadcastMessage = {
			id: crypto.randomUUID(),
			content,
			createdAt: new Date().toISOString(),
			senderId: sessionUserId
		};

		const broadcastError = await channel.send({
			type: 'broadcast',
			event: 'message',
			payload
		});

		if (broadcastError !== 'ok') {
			error = `Failed to broadcast message (${broadcastError}).`;
			sending = false;
			return;
		}

		void supabase
			.from('chat_messages')
			.insert({
				content,
				created_at: payload.createdAt,
				sender_id: payload.senderId
			})
			.then(({ error: insertError }) => {
				if (insertError) {
					error = `Message broadcasted but database insert failed: ${insertError.message}`;
				}
			});

		draft = '';
		sending = false;
		await tick();
		resizeComposer();
		scrollMessagesToBottom();
	};

	onMount(async () => {
		resizeComposer();
		await loadMessages();
		await connectRealtime();
	});

	onDestroy(() => {
		if (channel && supabase) {
			isRealtimeReady = false;
			void supabase.removeChannel(channel);
		}
	});
</script>

<div class="sketch-pattern flex min-h-screen flex-col text-[#111111]">
	<main class="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden px-6 py-6">
		{#if !hasSupabaseConfig}
			<section class="sketchy-border bg-[#fff0f0] p-4 text-2xl">
				Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY to start realtime chat.
			</section>
		{:else}
			{#if !isRealtimeReady}
				<p class="mb-3 text-sm tracking-[0.25em] opacity-70" aria-label="Connecting">...</p>
			{/if}
			<div class="chat-stream flex-1 space-y-6 overflow-y-auto pb-4" bind:this={messagesContainer}>
				{#if loading}
					<p class="sketchy-border bg-white px-4 py-2 text-base">Loading messages…</p>
				{:else if messages.length === 0}
					<p class="sketchy-border bg-white px-4 py-2 text-base">No messages yet.</p>
				{:else}
					{#each messages as message (message.id)}
						<div
							class={`message-row flex items-start gap-3 ${message.senderId === sessionUserId ? 'is-own flex-row-reverse' : ''}`}
						>
							<article
								class={`message-shell ${message.senderId === sessionUserId ? 'sketchy-border-alt bg-[#efefef]' : 'sketchy-border'}`}
							>
								<div class="markdown-body" aria-label="chat message markdown output">
									{@html message.safeHtml}
								</div>
							</article>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</main>

	<footer class="sketchy-border-top bg-[#f4f4f4] px-6 py-4">
		<form
			class="mx-auto flex w-full max-w-6xl items-center gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				void submitMessage();
			}}
		>
			<div class="input-shell sketchy-border flex-1">
				<textarea
					bind:this={composer}
					id="chat-input"
					bind:value={draft}
					rows="1"
					placeholder="Type your message..."
					class="w-full resize-none border-none bg-transparent px-3 py-2 text-xl leading-6 outline-none"
					oninput={resizeComposer}
					onkeydown={(event) => {
						if (event.key === 'Enter' && event.ctrlKey) {
							event.preventDefault();
							void submitMessage();
						}
					}}
				></textarea>
			</div>
			<button
				type="submit"
				disabled={sending || !draft.trim() || !isRealtimeReady || !hasSupabaseConfig}
				class="send-shell sketchy-border-alt disabled:opacity-50"
				aria-label="Send message"
			>
				<span class="text-sm font-medium">Send</span>
			</button>
		</form>
		{#if error}
			<p class="mx-auto mt-2 w-full max-w-6xl text-sm text-[#8b0000]">{error}</p>
		{/if}
	</footer>
</div>
