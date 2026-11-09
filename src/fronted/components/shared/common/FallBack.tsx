import React from 'react';

const FallBack = () => {
    return (
        <div className="flex items-center justify-center">
            <div className="bg-error-muted border border-error/40 text-error px-4 py-3 rounded relative" role="alert">
                <strong className="font-bold">Oh no! </strong>
                <span className="block sm:inline">Something went wrong.</span>
            </div>
        </div>
    );
};

export default FallBack;
