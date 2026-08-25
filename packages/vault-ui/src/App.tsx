import { useState } from 'react';
import DepositWithdrawModal from './components/DepositWithdrawModal';
import EarningsHistoryPage from './components/EarningsHistoryPage';

type AppView = 'modal' | 'earnings';

export default function App() {
  const [view, setView] = useState<AppView>('modal');

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">NeuroWealth Vault</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setView('modal')}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  view === 'modal'
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Deposit / Withdraw
              </button>
              <button
                onClick={() => setView('earnings')}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  view === 'earnings'
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Earnings History
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {view === 'modal' && <DepositWithdrawModal />}
        {view === 'earnings' && <EarningsHistoryPage />}
      </main>
    </div>
  );
}