<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { RealtimeChannel } from '@supabase/supabase-js';
	import { renderMarkdown } from '$lib/markdown';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';

	type DatabaseMessage = {
		id: number;
		content: string;
		created_at: string;
	};

	type UiMessage = {
		id: string;
		content: string;
		createdAt: string;
		safeHtml: string;
	};

	type BroadcastMessage = {
		id?: string;
		content: string;
		createdAt: string;
	};

	let messages: UiMessage[] = [];
	let draft = '';
	let loading = true;
	let error = '';
	let sending = false;
	let isRealtimeReady = false;

	let channel: RealtimeChannel | null = null;

	const toUiMessage = (message: { id: string; content: string; createdAt: string }): UiMessage => {
		return {
			id: message.id,
			content: message.content,
			createdAt: message.createdAt,
			safeHtml: renderMarkdown(message.content)
		};
	};

	const appendMessage = (message: UiMessage) => {
		messages = [...messages, message].slice(-40);
	};

	const loadMessages = async () => {
		if (!supabase) {
			loading = false;
			return;
		}

		const { data, error: loadError } = await supabase
			.from('chat_messages')
			.select('id, content, created_at')
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
				createdAt: entry.created_at
			})
		);

		loading = false;
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
						createdAt: incoming.createdAt
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
			createdAt: new Date().toISOString()
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
				created_at: payload.createdAt
			})
			.then(({ error: insertError }) => {
				if (insertError) {
					error = `Message broadcasted but database insert failed: ${insertError.message}`;
				}
			});

		draft = '';
		sending = false;
	};

	onMount(async () => {
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
	<header class="sketchy-border-bottom bg-[#f4f4f4] px-6 py-4">
		<div class="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
			<div class="flex items-center gap-2 text-3xl leading-none">
				<span class="material-icons-outlined text-3xl">chat</span>
				<h1 class="text-4xl font-semibold">MinimalChat</h1>
			</div>
			<nav class="hidden md:block">
				<ul class="flex items-center gap-6 text-2xl">
					<li><button type="button">Home</button></li>
					<li><button type="button">User Profile</button></li>
					<li><button type="button">Settings</button></li>
					<li><button type="button">Feedback</button></li>
				</ul>
			</nav>
		</div>
	</header>

	<main class="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden px-6 py-6">
		{#if !hasSupabaseConfig}
			<section class="sketchy-border bg-[#fff0f0] p-4 text-2xl">
				Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY to start realtime chat.
			</section>
		{:else}
			{#if !isRealtimeReady}
				<p class="mb-3 text-xl">Connecting realtime…</p>
			{/if}
			<div class="flex-1 space-y-6 overflow-y-auto pb-4">
				{#if loading}
					<p class="sketchy-border bg-white px-4 py-2 text-2xl">Loading messages…</p>
				{:else if messages.length === 0}
					<p class="sketchy-border bg-white px-4 py-2 text-2xl">No messages yet.</p>
				{:else}
					{#each messages as message, index (message.id)}
						<div class={`flex items-start gap-3 ${index % 2 === 1 ? 'flex-row-reverse' : ''}`}>
							<div class={`avatar-shell ${index % 2 === 1 ? 'sketchy-border-alt' : 'sketchy-border'}`}>
								<svg fill="none" width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<line x1="2" x2="22" y1="2" y2="22"></line>
									<line x1="22" x2="2" y1="2" y2="22"></line>
								</svg>
							</div>
							<article class={`message-shell ${index % 2 === 1 ? 'sketchy-border-alt bg-[#efefef]' : 'sketchy-border'}`}>
								<div class="mb-1 text-lg opacity-75">{new Date(message.createdAt).toLocaleString()}</div>
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
				<input
					id="chat-input"
					bind:value={draft}
					placeholder="Type your message..."
					class="w-full border-none bg-transparent px-3 py-2 text-2xl outline-none"
					onkeydown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault();
							void submitMessage();
						}
					}}
				/>
			</div>
			<button
				type="submit"
				disabled={sending || !draft.trim() || !isRealtimeReady || !hasSupabaseConfig}
				class="send-shell sketchy-border-alt disabled:opacity-50"
				aria-label="Send message"
			>
				<span class="material-icons-outlined text-3xl">send</span>
			</button>
		</form>
		{#if error}
			<p class="mx-auto mt-2 w-full max-w-6xl text-xl text-[#8b0000]">{error}</p>
		{/if}
	</footer>
</div>
