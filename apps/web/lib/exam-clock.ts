/** Wall-clock changes cannot change a running countdown. */
export class ExamClock {
    private deadline = 0;
    constructor(private readonly monotonicNow: () => number = () => performance.now()) {}

    anchor(remainingSeconds: number) {
        this.deadline = this.monotonicNow() + Math.max(0, remainingSeconds) * 1000;
    }

    remainingSeconds() {
        return Math.max(0, Math.ceil((this.deadline - this.monotonicNow()) / 1000));
    }
}
