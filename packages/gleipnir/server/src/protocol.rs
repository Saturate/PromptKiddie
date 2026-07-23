use bytes::{Buf, BufMut, BytesMut};
use std::io;
use tokio_util::codec::{Decoder, Encoder};

const MAGIC: u32 = 0x504B524C; // "PKRL"
const HEADER_LEN: usize = 13; // 4 magic + 4 length + 1 type + 4 request_id
const MAX_FRAME_LEN: usize = 512 * 1024 * 1024; // 512MB ceiling

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameType {
    Cmd = 1,
    CmdOutput = 2,
    FileUp = 3,
    FileDown = 4,
    SocksOpen = 5,
    SocksData = 6,
    SocksClose = 7,
    Ping = 8,
    Pong = 9,
    Info = 10,
    InfoResponse = 11,
    Error = 12,
    FileChunk = 13,
    FileEnd = 14,
}

impl FrameType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Cmd),
            2 => Some(Self::CmdOutput),
            3 => Some(Self::FileUp),
            4 => Some(Self::FileDown),
            5 => Some(Self::SocksOpen),
            6 => Some(Self::SocksData),
            7 => Some(Self::SocksClose),
            8 => Some(Self::Ping),
            9 => Some(Self::Pong),
            10 => Some(Self::Info),
            11 => Some(Self::InfoResponse),
            12 => Some(Self::Error),
            13 => Some(Self::FileChunk),
            14 => Some(Self::FileEnd),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct Frame {
    pub frame_type: FrameType,
    pub request_id: u32,
    pub payload: BytesMut,
}

#[allow(dead_code)]
impl Frame {
    pub fn new(frame_type: FrameType, request_id: u32, payload: impl Into<BytesMut>) -> Self {
        Self {
            frame_type,
            request_id,
            payload: payload.into(),
        }
    }

    pub fn ping(request_id: u32) -> Self {
        Self::new(FrameType::Ping, request_id, BytesMut::new())
    }

    pub fn pong(request_id: u32) -> Self {
        Self::new(FrameType::Pong, request_id, BytesMut::new())
    }

    pub fn cmd(request_id: u32, command: &str) -> Self {
        Self::new(
            FrameType::Cmd,
            request_id,
            BytesMut::from(command.as_bytes()),
        )
    }

    pub fn cmd_output(request_id: u32, output: &[u8]) -> Self {
        Self::new(FrameType::CmdOutput, request_id, BytesMut::from(output))
    }

    pub fn error(request_id: u32, msg: &str) -> Self {
        Self::new(FrameType::Error, request_id, BytesMut::from(msg.as_bytes()))
    }

    pub fn info_request(request_id: u32) -> Self {
        Self::new(FrameType::Info, request_id, BytesMut::new())
    }

    pub fn payload_as_str(&self) -> Option<&str> {
        std::str::from_utf8(&self.payload).ok()
    }
}

pub struct GleipnirCodec;

impl Decoder for GleipnirCodec {
    type Item = Frame;
    type Error = io::Error;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Self::Item>, Self::Error> {
        if src.len() < HEADER_LEN {
            return Ok(None);
        }

        let magic = u32::from_be_bytes([src[0], src[1], src[2], src[3]]);
        if magic != MAGIC {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("bad magic: 0x{magic:08X}, expected 0x{MAGIC:08X}"),
            ));
        }

        let payload_len = u32::from_be_bytes([src[4], src[5], src[6], src[7]]) as usize;
        if payload_len > MAX_FRAME_LEN {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("frame too large: {payload_len} bytes"),
            ));
        }

        let total = HEADER_LEN + payload_len;
        if src.len() < total {
            src.reserve(total - src.len());
            return Ok(None);
        }

        src.advance(8); // magic + length
        let type_byte = src.get_u8();
        let request_id = src.get_u32();
        let payload = src.split_to(payload_len);

        let frame_type = FrameType::from_u8(type_byte).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("unknown frame type: {type_byte}"),
            )
        })?;

        Ok(Some(Frame {
            frame_type,
            request_id,
            payload,
        }))
    }
}

impl Encoder<Frame> for GleipnirCodec {
    type Error = io::Error;

    fn encode(&mut self, frame: Frame, dst: &mut BytesMut) -> Result<(), Self::Error> {
        let payload_len = frame.payload.len();
        if payload_len > MAX_FRAME_LEN {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("payload too large: {payload_len} bytes"),
            ));
        }

        dst.reserve(HEADER_LEN + payload_len);
        dst.put_u32(MAGIC);
        dst.put_u32(u32::try_from(payload_len).expect("MAX_FRAME_LEN fits u32"));
        dst.put_u8(frame.frame_type as u8);
        dst.put_u32(frame.request_id);
        dst.extend_from_slice(&frame.payload);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(frame: Frame) -> Frame {
        let mut codec = GleipnirCodec;
        let mut buf = BytesMut::new();
        codec.encode(frame.clone(), &mut buf).unwrap();
        codec.decode(&mut buf).unwrap().unwrap()
    }

    #[test]
    fn ping_pong_roundtrip() {
        let frame = Frame::ping(42);
        let decoded = roundtrip(frame);
        assert_eq!(decoded.frame_type, FrameType::Ping);
        assert_eq!(decoded.request_id, 42);
        assert!(decoded.payload.is_empty());
    }

    #[test]
    fn cmd_roundtrip() {
        let frame = Frame::cmd(1, "whoami");
        let decoded = roundtrip(frame);
        assert_eq!(decoded.frame_type, FrameType::Cmd);
        assert_eq!(decoded.request_id, 1);
        assert_eq!(decoded.payload_as_str().unwrap(), "whoami");
    }

    #[test]
    fn cmd_output_roundtrip() {
        let output = b"root\n";
        let frame = Frame::cmd_output(1, output);
        let decoded = roundtrip(frame);
        assert_eq!(decoded.frame_type, FrameType::CmdOutput);
        assert_eq!(&decoded.payload[..], output);
    }

    #[test]
    fn large_payload() {
        let data = vec![0xAB_u8; 128 * 1024];
        let frame = Frame::new(FrameType::FileUp, 99, BytesMut::from(&data[..]));
        let decoded = roundtrip(frame);
        assert_eq!(decoded.frame_type, FrameType::FileUp);
        assert_eq!(decoded.payload.len(), 128 * 1024);
        assert!(decoded.payload.iter().all(|&b| b == 0xAB));
    }

    #[test]
    fn bad_magic_rejected() {
        let mut buf = BytesMut::new();
        buf.put_u32(0xDEADBEEF);
        buf.put_u32(0); // length
        buf.put_u8(1); // type
        buf.put_u32(1); // request_id

        let mut codec = GleipnirCodec;
        let err = codec.decode(&mut buf).unwrap_err();
        assert!(err.to_string().contains("bad magic"));
    }

    #[test]
    fn unknown_frame_type_rejected() {
        let mut codec = GleipnirCodec;
        let mut buf = BytesMut::new();
        buf.put_u32(MAGIC);
        buf.put_u32(0);
        buf.put_u8(255);
        buf.put_u32(1);

        let err = codec.decode(&mut buf).unwrap_err();
        assert!(err.to_string().contains("unknown frame type"));
    }

    #[test]
    fn partial_header_returns_none() {
        let mut codec = GleipnirCodec;
        let mut buf = BytesMut::from(&[0x50, 0x4B, 0x52][..]);
        assert!(codec.decode(&mut buf).unwrap().is_none());
    }

    #[test]
    fn partial_payload_returns_none() {
        let mut codec = GleipnirCodec;
        let mut buf = BytesMut::new();
        buf.put_u32(MAGIC);
        buf.put_u32(100); // claims 100 bytes of payload
        buf.put_u8(1);
        buf.put_u32(1);
        buf.extend_from_slice(&[0u8; 50]); // only 50 bytes present

        assert!(codec.decode(&mut buf).unwrap().is_none());
    }

    #[test]
    fn multiple_frames_in_buffer() {
        let mut codec = GleipnirCodec;
        let mut buf = BytesMut::new();

        codec.encode(Frame::ping(1), &mut buf).unwrap();
        codec.encode(Frame::cmd(2, "ls"), &mut buf).unwrap();
        codec.encode(Frame::pong(3), &mut buf).unwrap();

        let f1 = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(f1.frame_type, FrameType::Ping);
        assert_eq!(f1.request_id, 1);

        let f2 = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(f2.frame_type, FrameType::Cmd);
        assert_eq!(f2.request_id, 2);

        let f3 = codec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(f3.frame_type, FrameType::Pong);
        assert_eq!(f3.request_id, 3);

        assert!(codec.decode(&mut buf).unwrap().is_none());
    }

    #[test]
    fn frame_too_large_rejected() {
        let mut codec = GleipnirCodec;
        let mut buf = BytesMut::new();
        buf.put_u32(MAGIC);
        buf.put_u32((MAX_FRAME_LEN + 1) as u32);
        buf.put_u8(1);
        buf.put_u32(1);

        let err = codec.decode(&mut buf).unwrap_err();
        assert!(err.to_string().contains("frame too large"));
    }

    #[test]
    fn error_frame_roundtrip() {
        let frame = Frame::error(5, "connection refused");
        let decoded = roundtrip(frame);
        assert_eq!(decoded.frame_type, FrameType::Error);
        assert_eq!(decoded.payload_as_str().unwrap(), "connection refused");
    }

    #[test]
    fn all_frame_types_valid() {
        for t in 1..=14_u8 {
            assert!(FrameType::from_u8(t).is_some(), "type {t} should be valid");
        }
        assert!(FrameType::from_u8(0).is_none());
        assert!(FrameType::from_u8(15).is_none());
    }
}
