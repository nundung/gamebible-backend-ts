// 타입만 모아놓은 파일 d.ts
// 글로벌 타입 지정

declare global {
    namespace Express {
        interface Request {
            decoded: {
                userIdx: number;
                isAdmin: boolean;
            };
        }
    }
}

export {};
