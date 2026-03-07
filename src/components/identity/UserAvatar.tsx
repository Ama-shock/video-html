import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { generateIdenticonDataUrl } from '../../identity/identicon';
import type { RootState } from '../../store';

type Props = { size?: number };

export default function UserAvatar({ size = 40 }: Props) {
	const publicKeyB64 = useSelector((s: RootState) => s.identity.publicKeyB64);
	const username = useSelector((s: RootState) => s.identity.username);
	const [dataUrl, setDataUrl] = useState<string | null>(null);

	useEffect(() => {
		if (publicKeyB64) {
			generateIdenticonDataUrl(publicKeyB64).then(setDataUrl);
		}
	}, [publicKeyB64]);

	if (!dataUrl) return <div className="avatar-placeholder" style={{ width: size, height: size }} />;

	return (
		<img
			className="user-avatar"
			src={dataUrl}
			alt={username || 'User'}
			title={username}
			width={size}
			height={size}
			style={{ borderRadius: 4 }}
		/>
	);
}
