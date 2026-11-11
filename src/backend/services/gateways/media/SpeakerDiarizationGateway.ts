/**
 * 一个说话人分段：同一说话人在连续时间内的发言区间。
 */
export interface SpeakerSegment {
    /** 分段开始时间，单位秒。 */
    start: number;
    /** 分段结束时间，单位秒。 */
    end: number;
    /** 说话人标签，如 `speaker_00`；同一音频内稳定且唯一。 */
    speaker: string;
}

/**
 * 说话人分离请求。
 */
export interface SpeakerDiarizationRequest {
    /** 16kHz 单声道 PCM WAV 音频路径。 */
    audioPath: string;
    /** 模型根目录。 */
    modelsRoot: string;
    /** 所属后台任务身份标识。 */
    job?: string;
    /** 取消判定；返回 true 时立即终止分离。 */
    isCancelled?: () => boolean;
    /** 分离进程存活期间的心跳回调。 */
    onHeartbeat?: () => void;
}

/**
 * 说话人分离结果。
 */
export interface SpeakerDiarizationResult {
    /** 按开始时间升序的分段；音频无人声时为空数组。 */
    segments: SpeakerSegment[];
    /** 识别出的不同说话人数量。 */
    speakerCount: number;
}

/**
 * 本地说话人分离端口。
 */
export default interface SpeakerDiarizationGateway {
    /**
     * 分离一个音频文件中的说话人。
     *
     * 模型未安装或执行失败时抛出显式错误：调用方据此降级为文本启发式，
     * 而不是把「没有声纹」伪装成「只有一个人说话」。
     *
     * @param request 音频、模型与生命周期参数。
     * @returns 分段列表与说话人数量。
     */
    diarize(request: SpeakerDiarizationRequest): Promise<SpeakerDiarizationResult>;

    /**
     * 终止指定 job 的分离进程。
     * @param job 目标任务的 job 标识；缺省时终止全部。
     */
    cancelActive(job?: string): void;
}
