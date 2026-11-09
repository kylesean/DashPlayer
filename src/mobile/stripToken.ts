/**
 * 抹掉地址栏里的访问令牌。
 *
 * 桌面端展示的访问地址形如 http://192.168.1.2:27182/?t=<令牌>，
 * 服务端在首次响应里已经把令牌写进 HttpOnly Cookie，后续请求不再需要它。
 * 这里用 replaceState 把它从地址栏和浏览历史里去掉，避免令牌被误分享出去。
 */
export const stripAccessTokenFromUrl = (): void => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('t')) {
        return;
    }
    url.searchParams.delete('t');
    // replaceState 而不是 pushState：这一条历史记录不该留下来。
    window.history.replaceState(null, '', url.toString());
};
