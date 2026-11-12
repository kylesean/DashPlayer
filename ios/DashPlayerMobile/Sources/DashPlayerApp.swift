import AVFoundation
import SwiftUI

/// 应用入口。
@main
struct DashPlayerMobileApp: App {
    @StateObject private var server = ServerStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(server)
                .task {
                    AudioSession.activate()
                    AudioSession.observeInterruptions()
                }
        }
    }
}

/// 根据是否已经连上服务决定进入列表页还是地址填写页。
struct RootView: View {
    @EnvironmentObject private var server: ServerStore
    @AppStorage(ThemePreference.storageKey) private var themeRaw = ThemePreference.system.rawValue

    var body: some View {
        Group {
            if let baseURL = server.baseURL {
                RecentListView(api: APIClient(baseURL: baseURL, token: server.token))
                    .id(baseURL)
            } else {
                ServerSetupView()
            }
        }
        .preferredColorScheme(ThemePreference(rawValue: themeRaw)?.colorScheme)
    }
}

/// 后台播放所需的音频会话。
enum AudioSession {
    /// 是否已经挂过中断/路由监听；`.task` 在视图重建时可能重跑，重复注册会让回调叠加。
    private static var observing = false

    /// 打开播放类别，让视频在锁屏和切后台后继续出声。
    static func activate() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setActive(true)
        } catch {
            // 以前用 try? 静默吞掉：首次激活失败时锁屏播放会无声，而日志里查不到任何线索。
            NSLog("[Refrain] audio session activate failed: %@", String(describing: error))
        }
    }

    /// 监听系统音频中断与设备路由变化，结束后重新激活会话。
    ///
    /// 只在启动时激活一次是不够的：来电、Siri、闹钟等中断结束时系统会把会话置为
    /// inactive，不重新激活的话锁屏/后台播放会无声且不会自行恢复，用户只能重启 App。
    static func observeInterruptions() {
        guard !observing else {
            return
        }
        observing = true
        let center = NotificationCenter.default
        center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { notification in
            guard
                let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                let type = AVAudioSession.InterruptionType(rawValue: raw)
            else {
                return
            }
            switch type {
            case .began:
                // 系统已接管音频，这里不需要做任何事；播放器本身会被系统暂停。
                NSLog("[Refrain] audio session interrupted")
            case .ended:
                // 中断结束：只有系统允许恢复时才重新激活，否则会再次被打断。
                let options = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                    .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
                guard options.contains(.shouldResume) else {
                    NSLog("[Refrain] audio session interruption ended without resume option")
                    return
                }
                activate()
            @unknown default:
                activate()
            }
        }

        // 耳机拔出、蓝牙断开等路由变化同样会把会话打回 inactive。
        center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { notification in
            guard
                let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
            else {
                return
            }
            switch reason {
            case .oldDeviceUnavailable, .override, .routeConfigurationChange, .wakeFromSleep:
                activate()
            default:
                break
            }
        }
    }
}
