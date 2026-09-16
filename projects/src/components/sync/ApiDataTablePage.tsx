'use client';

import { useState } from 'react';
import DataTableBrowser from './DataTableBrowser';
import DataSyncPlatform from './DataSyncPlatform';

type Mode = 'browse' | 'platform';

export default function ApiDataTablePage() {
  const [mode, setMode] = useState<Mode>('browse');

  return (
    <div className="flex h-full flex-col px-2 pt-1 md:px-4">
      {/* 模式切换 */}
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => setMode('browse')}
          className={`rounded-md px-3 py-1.5 text-sm ${mode === 'browse' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          数据表浏览
        </button>
        <button
          onClick={() => setMode('platform')}
          className={`rounded-md px-3 py-1.5 text-sm ${mode === 'platform' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          数据同步平台
        </button>
      </div>

      <div className="min-h-0 flex-1 rounded-lg">
        {mode === 'browse' ? (
          <DataTableBrowser onOpenPlatform={() => setMode('platform')} />
        ) : (
          <DataSyncPlatform />
        )}
      </div>
    </div>
  );
}