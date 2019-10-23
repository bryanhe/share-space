import React, { Component } from "react";
import "./Room.css";

// Must match the video stream from the room server, as encoded by FFmpeg.
const mimeType = 'video/webm; codecs="vp9,opus"';
const maxLag = 5,
  maxBufferSize = 20,
  playbackSlop = 1,
  bufferSlop = 5;

/**
 * The main interface to spaces, using a websocket.
 *
 * - Maintains a websocket ocnnection to the space server.
 * - Displays the desktop stream
 * - Captures user input for remote desktop control
 */
export default class WebsocketRoom extends Component {
  constructor(props) {
    super(props);
    this.state = { status: "Waiting to connect" };
    this.videoRef = React.createRef();
    this.pendingBuffers = [];

    if (!MediaSource.isTypeSupported(mimeType)) {
      throw Error(`MIME type ${mimeType} not supported`);
    }
  }

  async connect() {
    const ws = (this.ws = new WebSocket(`ws://${this.props.spaceUrl}/stream`));
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      this.setState({ status: "Connected" });
    };
    ws.onerror = event => {
      this.setState({ status: `Error: ${event}` });
    };
    ws.onclose = () => {
      this.setState({ status: "Closed" });
    };
    ws.onmessage = event => {
      if (this.sourceBuffer) {
        this.logPlayback(this.videoRef.current);
        this.updateBuffer(event.data);
      } else {
        console.log("no sourceBuffer yet");
      }
      this.setState({
        lastMessageTime: performance.now()
      });
    };

    const videoSource = (this.videoSource = new MediaSource());
    videoSource.addEventListener("sourceopen", () => {
      this.sourceBuffer = videoSource.addSourceBuffer(mimeType);
      this.sourceBuffer.onupdate = () => this.updateBuffer();
    });

    this.videoRef.current.src = URL.createObjectURL(videoSource);
  }

  logPlayback(video) {
    if (video.error) {
      console.error(this.videoRef.current.error);
    }

    const bufferedRanges = [];
    let i;
    for (i = 0; i < video.buffered.length; i++) {
      bufferedRanges.push([video.buffered.start(i), video.buffered.end(i)]);
    }

    console.log(
      `Current playback time: ${
        video.currentTime
      }. Available seek ahead: ${(video.seekable.length
        ? video.seekable.end(0)
        : 0) - video.currentTime}, # pending buffers: ${
        this.pendingBuffers.length
      }. Buffered ranges: ${bufferedRanges}. MediaSource duration: ${
        this.videoSource.duration
      }`
    );
  }

  tryAppendBuffer = () => {
    if (this.sourceBuffer.updating) {
      console.warn("sourcebuffer is updating, not appending");
    } else {
      const buffer = this.pendingBuffers.shift();
      if (buffer) {
        this.sourceBuffer.appendBuffer(buffer);
      }
    }
  };

  updateBuffer = newData => {
    if (newData) {
      this.pendingBuffers.push(newData);
    }

    if (this.sourceBuffer.updating) {
      console.warn("sourcebuffer is updating");
      return;
    }

    if (this.pendingBuffers.length) {
      this.sourceBuffer.appendBuffer(this.pendingBuffers.shift());
    } else {
      this.pruneBuffer();
    }
  };

  pruneBuffer = () => {
    if (this.videoRef.current && this.videoRef.current.buffered.length) {
      const buffered = this.videoRef.current.buffered,
        lastBufferStartTime = buffered.start(buffered.length - 1),
        lastBufferEndTime = buffered.end(buffered.length - 1),
        firstBufferStartTime = buffered.start(0),
        currentPlaybackTime = this.videoRef.current.currentTime;

      if (lastBufferEndTime - currentPlaybackTime > maxLag) {
        const newPlaybackTime = Math.max(
          lastBufferStartTime,
          lastBufferEndTime - playbackSlop
        );
        console.log(`Seeking to ${newPlaybackTime}`);
        this.videoRef.current.currentTime = newPlaybackTime;
      }

      if (lastBufferEndTime - firstBufferStartTime > maxBufferSize) {
        const newBufferEndTime = Math.max(
          0,
          Math.min(
            this.videoRef.current.currentTime - bufferSlop,
            lastBufferEndTime - bufferSlop
          )
        );
        console.log(`Removing buffers in range 0, ${newBufferEndTime}`);
        this.sourceBuffer.remove(0, newBufferEndTime);
      }
    }
  };

  componentDidMount() {
    if (this.props.spaceUrl) {
      this.connect();
    }
  }

  componentWillUnmount() {
    if (this.props.spaceUrl) {
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
    }
  }

  render() {
    return (
      <div className="room">
        <div>{`spaceUrl: ${this.props.spaceUrl}`}</div>
        <div>{`status: ${this.state.status}`}</div>
        <div>{`latest message time: ${this.state.lastMessageTime}`}</div>
        <video autoPlay={true} ref={this.videoRef} className="video" />
      </div>
    );
  }
}
