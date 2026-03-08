import { useEffect, useState } from 'react';
import { type GuestEntry, deleteGuest, listGuests, saveGuest } from '../../db/guestRegistry';
import { generateIdenticonDataUrl } from '../../identity/identicon';

type Props = {
	/** 初期表示時に展開するか */
	defaultOpen: boolean;
};

function KnownGuestCard({
	entry,
	onToggleAllowed,
	onDelete,
}: {
	entry: GuestEntry;
	onToggleAllowed: () => void;
	onDelete: () => void;
}) {
	const [avatar, setAvatar] = useState<string | null>(null);

	useEffect(() => {
		generateIdenticonDataUrl(entry.userId).then(setAvatar);
	}, [entry.userId]);

	return (
		<div className="guest-card">
			{avatar && <img src={avatar} alt={entry.username} className="guest-avatar" />}
			<div className="guest-info">
				<span className="guest-name">{entry.username}</span>
				<span className="guest-id" title={entry.userId}>
					{entry.userId.slice(0, 12)}…
				</span>
				<span className="guest-state" style={{ color: entry.allowed ? '#0a0' : '#888' }}>
					{entry.allowed ? '許可済み' : '未許可'}
				</span>
			</div>
			<div className="guest-actions">
				<button
					type="button"
					className={`btn btn-sm ${entry.allowed ? 'btn-secondary' : 'btn-primary'}`}
					onClick={onToggleAllowed}
				>
					{entry.allowed ? '取消' : '許可'}
				</button>
				<button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
					削除
				</button>
			</div>
		</div>
	);
}

export default function KnownGuestList({ defaultOpen }: Props) {
	const [open, setOpen] = useState(defaultOpen);
	const [entries, setEntries] = useState<GuestEntry[]>([]);

	const refresh = async () => {
		const all = await listGuests();
		// 最終接続日時の降順
		all.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
		setEntries(all);
	};

	useEffect(() => {
		refresh();
	}, []);

	// defaultOpen が変わったら反映（部屋開放時に折りたたむ）
	useEffect(() => {
		setOpen(defaultOpen);
	}, [defaultOpen]);

	const handleToggleAllowed = async (entry: GuestEntry) => {
		await saveGuest({ ...entry, allowed: !entry.allowed });
		await refresh();
	};

	const handleDelete = async (userId: string) => {
		await deleteGuest(userId);
		await refresh();
	};

	return (
		<div className="known-guests">
			<button
				type="button"
				className="known-guests-toggle"
				onClick={() => setOpen((v) => !v)}
			>
				<span className="known-guests-arrow">{open ? '▼' : '▶'}</span>
				<span>過去の接続ゲスト ({entries.length})</span>
			</button>
			{open && (
				<div className="known-guests-body">
					{entries.length === 0 ? (
						<p className="empty-msg">過去の接続ゲストはいません</p>
					) : (
						entries.map((e) => (
							<KnownGuestCard
								key={e.userId}
								entry={e}
								onToggleAllowed={() => handleToggleAllowed(e)}
								onDelete={() => handleDelete(e.userId)}
							/>
						))
					)}
				</div>
			)}
		</div>
	);
}
