<script lang="ts">
	import { onMount } from "svelte";
	import { hasSupabaseConfig, supabase } from "$lib/supabase";

	type DatabaseMessage = {
		id: number;
		content: string;
		created_at: string;
		sender_id: string;
		is_pinned: boolean;
	};

	let messages: DatabaseMessage[] = [];
	let loading = true;
	let error = "";
	let selectedMessageIds: number[] = [];

	$: allSelected =
		messages.length > 0 && selectedMessageIds.length === messages.length;
	$: isIndeterminate =
		selectedMessageIds.length > 0 &&
		selectedMessageIds.length < messages.length;

	const toggleSelectAll = (event: Event) => {
		const target = event.target as HTMLInputElement;
		if (target.checked) {
			selectedMessageIds = messages.map((m) => m.id);
		} else {
			selectedMessageIds = [];
		}
	};

	const toggleSelect = (id: number) => {
		if (selectedMessageIds.includes(id)) {
			selectedMessageIds = selectedMessageIds.filter(
				(selectedId) => selectedId !== id,
			);
		} else {
			selectedMessageIds = [...selectedMessageIds, id];
		}
	};

	const loadMessages = async () => {
		if (!supabase) {
			loading = false;
			return;
		}

		const { data, error: loadError } = await supabase
			.from("chat_messages")
			.select("*")
			.order("created_at", { ascending: false })
			.limit(100);

		if (loadError) {
			error = loadError.message;
			loading = false;
			return;
		}

		messages = data as DatabaseMessage[];
		loading = false;
	};

	const deleteMessages = async (ids: number[]) => {
		if (!supabase || ids.length === 0) return;
		if (
			!confirm(
				`Are you sure you want to delete ${ids.length} message${ids.length > 1 ? "s" : ""}?`,
			)
		)
			return;

		const { error: delError } = await supabase
			.from("chat_messages")
			.delete()
			.in("id", ids);

		if (delError) {
			alert("Failed to delete: " + delError.message);
		} else {
			messages = messages.filter((m) => !ids.includes(m.id));
			selectedMessageIds = [];
		}
	};

	const togglePin = async (id: number, currentState: boolean) => {
		if (!supabase) return;

		const { error: updateError } = await supabase
			.from("chat_messages")
			.update({ is_pinned: !currentState })
			.eq("id", id);

		if (updateError) {
			alert("Failed to update pin: " + updateError.message);
		} else {
			messages = messages.map((m) =>
				m.id === id ? { ...m, is_pinned: !currentState } : m,
			);
		}
	};

	const handleLogout = () => {
		sessionStorage.removeItem("chatboard_is_admin");
		window.location.href = "/";
	};

	onMount(() => {
		const isAdmin = sessionStorage.getItem("chatboard_is_admin") === "true";
		if (!isAdmin) {
			window.location.href = "/";
			return;
		}
		loadMessages();
	});
</script>

<div class="sketch-pattern min-h-[100dvh] text-[#111111] py-8 px-6">
	<div class="mx-auto max-w-6xl">
		<header
			class="sketchy-border bg-white px-6 py-4 flex items-center justify-between mb-8"
		>
			<h1 class="text-2xl font-bold">Admin Dashboard</h1>
			<nav class="flex gap-4">
				<button
					class="sketchy-border bg-white px-4 py-2 text-sm font-medium hover:bg-[#FFFDE7]"
					onclick={handleLogout}>Logout</button
				>
				<a
					href="/"
					class="sketchy-border bg-[#efefef] px-4 py-2 text-sm font-medium hover:bg-[#e0e0e0]"
					>Back to Chat</a
				>
			</nav>
		</header>

		<main class="sketchy-border bg-white p-6">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-xl font-bold">Message Management</h2>
				{#if selectedMessageIds.length > 0}
					<button
						class="sketchy-border bg-red-50 text-red-600 px-4 py-2 hover:bg-red-100 font-bold"
						onclick={() => deleteMessages(selectedMessageIds)}
					>
						Delete Selected ({selectedMessageIds.length})
					</button>
				{/if}
			</div>

			{#if !hasSupabaseConfig}
				<p class="text-red-600 font-bold">Supabase config missing!</p>
			{:else if loading}
				<p>Loading messages...</p>
			{:else if error}
				<p class="text-[#8b0000]">{error}</p>
			{:else}
				<div class="overflow-x-auto">
					<table
						class="w-full text-left sketchy-border-alt table-auto"
					>
						<thead>
							<tr class="bg-[#f4f4f4] border-b-2 border-black">
								<th class="p-3 w-10 text-center">
									<input
										type="checkbox"
										class="w-4 h-4 cursor-pointer"
										checked={allSelected}
										indeterminate={isIndeterminate}
										onchange={toggleSelectAll}
									/>
								</th>
								<th class="p-3 whitespace-nowrap">ID</th>
								<th class="p-3 whitespace-nowrap">Sender</th>
								<th class="p-3">Content (Raw)</th>
								<th class="p-3 whitespace-nowrap">Date</th>
								<th class="p-3 text-center whitespace-nowrap"
									>Pinned</th
								>
								<th class="p-3 text-right whitespace-nowrap"
									>Actions</th
								>
							</tr>
						</thead>
						<tbody>
							{#each messages as msg}
								<tr
									class="border-b border-gray-200 hover:bg-[#fafafa] {selectedMessageIds.includes(
										msg.id,
									)
										? 'bg-[#fffdf0]'
										: ''}"
								>
									<td class="p-3 text-center">
										<input
											type="checkbox"
											class="w-4 h-4 cursor-pointer"
											checked={selectedMessageIds.includes(
												msg.id,
											)}
											onchange={() =>
												toggleSelect(msg.id)}
										/>
									</td>
									<td class="p-3 text-sm">{msg.id}</td>
									<td
										class="p-3 text-sm font-mono truncate max-w-[100px]"
										title={msg.sender_id}
										>{msg.sender_id.substring(0, 8)}...</td
									>
									<td
										class="p-3 text-sm max-w-xs truncate"
										title={msg.content}>{msg.content}</td
									>
									<td class="p-3 text-sm whitespace-nowrap"
										>{new Date(
											msg.created_at,
										).toLocaleString()}</td
									>
									<td class="p-3 text-center">
										<button
											class="hover:scale-110 transition-transform cursor-pointer"
											onclick={() =>
												togglePin(
													msg.id,
													!!msg.is_pinned,
												)}
											title={msg.is_pinned
												? "Unpin message"
												: "Pin message"}
										>
											{msg.is_pinned ? "Yes" : "—"}
										</button>
									</td>
									<td class="p-3 text-right">
										<button
											class="text-red-600 hover:text-red-800 text-sm font-bold"
											onclick={() =>
												deleteMessages([msg.id])}
										>
											Delete
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</main>
	</div>
</div>
