import type { FallbackProps } from 'react-error-boundary';

const FallBack = ({ resetErrorBoundary }: Partial<FallbackProps>) => {
    return (
        <div className="flex h-full w-full items-center justify-center p-4">
            <div className="bg-error-muted border border-error/40 text-error px-4 py-3 rounded relative flex items-center gap-3" role="alert">
                <div>
                    <strong className="font-bold">Oh no! </strong>
                    <span className="block sm:inline">Something went wrong.</span>
                </div>
                {resetErrorBoundary && (
                    <button
                        type="button"
                        onClick={resetErrorBoundary}
                        className="px-2.5 py-1 text-xs font-medium rounded border border-error/40 hover:bg-error/10 transition-colors cursor-pointer"
                    >
                        Retry
                    </button>
                )}
            </div>
        </div>
    );
};

export default FallBack;
