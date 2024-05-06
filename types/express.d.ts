// 타입만 모아놓은 파일 d.ts
// 글로벌 타입 지정

declare global {
    namespace Express {
        interface Request {
            decoded: {
                idx: number;
                id: string;
                isAdmin: boolean;
            };
        }
    }
}

export {};
