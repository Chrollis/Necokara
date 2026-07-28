import type { UpdateStatus } from '../../renderer/hooks/useUpdater';

interface UpdateButtonProps {
  status: UpdateStatus;
  onInstall: () => void;
}

const GITHUB_ROOT = 'https://github.com/Chrollis/Necokara';

export default function UpdateButton({ status, onInstall }: UpdateButtonProps) {
  const { type } = status;

  if (type === 'checking') return null;

  if (type === 'not-available') {
    return (
      <button
        className="ubtn ubtn-up-to-date"
        onClick={() => window.open(GITHUB_ROOT)}
        title="打开 GitHub 主页"
      >
        已是最新
      </button>
    );
  }

  if (type === 'error') {
    return (
      <button
        className="ubtn ubtn-error"
        onClick={() => window.open(GITHUB_ROOT + '/releases')}
        title="打开 GitHub Releases"
      >
        检测更新失败
      </button>
    );
  }

  if (type === 'available' && status.isPortable) {
    return (
      <button
        className="ubtn ubtn-ready"
        onClick={() => window.open(status.releaseUrl)}
        title="前往下载新版本"
      >
        发现新版本
      </button>
    );
  }

  if (type === 'downloading' || type === 'available') {
    const label =
      type === 'downloading' ? `下载中 ${status.percent}%` : '下载更新中';
    return (
      <button
        className="ubtn ubtn-downloading"
        onClick={() => window.open(status.releaseUrl)}
        title="打开此版本的 GitHub Releases"
      >
        {type === 'downloading' ? null : <span className="ubtn-spinner" />}
        {label}
      </button>
    );
  }

  if (type === 'downloaded') {
    if (status.isPortable) {
      return (
        <button
          className="ubtn ubtn-ready"
          onClick={() => window.open(status.releaseUrl)}
          title="前往 GitHub 下载"
        >
          前往下载
        </button>
      );
    }
    return (
      <button
        className="ubtn ubtn-ready"
        onClick={onInstall}
        title="重启以安装更新"
      >
        更新
      </button>
    );
  }

  return null;
}
