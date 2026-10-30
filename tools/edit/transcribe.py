# Ported from browser-use/video-use helpers/transcribe.py (MIT)
"""Cached transcription with verbatim word timestamps: local faster-whisper or Groq Whisper API."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODELS = {"groq-large-v3":"whisper-large-v3","groq-turbo":"whisper-large-v3-turbo"}
GROQ_CHUNK_SECONDS = 600  # each upload stays far below the 25 MB free-tier limit
ENGINE_MODELS = {"local":("medium","large-v3-turbo"),"groq":tuple(GROQ_MODELS)}


def capture(args):
    return subprocess.run(args,capture_output=True,text=True,encoding="utf-8",errors="replace",check=True)


def groq_key():
    """GROQ_API_KEY from the environment, else a KEY=VALUE line in <repo>/.env (gitignored)."""
    key = os.environ.get("GROQ_API_KEY","").strip()
    env = Path(__file__).resolve().parents[2]/".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            name, _, value = line.partition("=")
            if name.strip()=="GROQ_API_KEY":
                key = value.strip().strip("\"'")
    return key


def local_words(video, model_name, lang):
    from faster_whisper import WhisperModel
    # Never download a missing model. Batch runs two processes with four CPU threads each.
    model = WhisperModel(model_name,device="cpu",compute_type="int8",
                         cpu_threads=min(4,os.cpu_count() or 4),local_files_only=True)
    options = {"word_timestamps":True,"vad_filter":False}
    if lang=="ar":
        options["initial_prompt"]="امم، اه، يعني"
    segments, detected = model.transcribe(str(video),language=None if lang=="auto" else lang,**options)
    words = []
    for segment in segments:
        for word in segment.words or []:
            words.append({"w":word.word.strip(),"s":round(word.start,3),"e":round(word.end,3),
                          "p":round(word.probability,3)})
    return words, detected.language


def groq_chunk(path, model, lang):
    import requests
    key = groq_key()
    if not key:
        raise ValueError("No Groq key: set GROQ_API_KEY or add GROQ_API_KEY=... to <repo>/.env")
    data = {"model":model,"response_format":"verbose_json","temperature":"0",
            "timestamp_granularities[]":"word"}
    if lang!="auto":
        data["language"] = lang
    if lang=="ar":
        data["prompt"] = "امم، اه، يعني"
    for attempt in range(6):
        with open(path,"rb") as fh:
            reply = requests.post(GROQ_URL,headers={"Authorization":f"Bearer {key}"},
                                  data=data,files={"file":(path.name,fh,"audio/flac")},timeout=300)
        if reply.status_code==429 or reply.status_code>=500:
            wait = float(reply.headers.get("retry-after") or 5*(attempt+1))
            print(f"Groq {reply.status_code}, retry in {wait:.0f}s",file=sys.stderr)
            time.sleep(wait)
            continue
        if reply.status_code==401:
            raise ValueError("Groq rejected the API key (401)")
        if not reply.ok:
            raise ValueError(f"Groq error {reply.status_code}: {reply.text[:300]}")
        return reply.json()
    raise ValueError("Groq still rate-limited after retries (free tier: 20 req/min, 7200 audio s/hour)")


def groq_words(video, model_name, lang, total):
    """Chunk the audio to 16 kHz mono FLAC, send each piece, shift word times by the chunk offset."""
    words, language = [], None
    with tempfile.TemporaryDirectory() as tmp:
        for index, offset in enumerate(range(0,math.ceil(total),GROQ_CHUNK_SECONDS)):
            piece = Path(tmp)/f"chunk{index}.flac"
            capture(["ffmpeg","-hide_banner","-nostats","-y","-ss",str(offset),"-t",str(GROQ_CHUNK_SECONDS),
                     "-i",str(video),"-map","0:a:0","-vn","-ac","1","-ar","16000","-c:a","flac",str(piece)])
            if not piece.exists() or piece.stat().st_size<1024:
                continue
            reply = groq_chunk(piece,model_name,lang)
            language = language or reply.get("language")
            for word in reply.get("words") or []:
                text = word["word"].strip()
                if text:
                    words.append({"w":text,"s":round(offset+word["start"],3),"e":round(offset+word["end"],3),"p":1.0})
    codes = {"arabic":"ar","english":"en"}
    language = language or lang
    return words, codes.get(language.lower(),language)


def transcribe_one(video, edit, model_name=None, lang="auto", engine="auto"):
    """engine: local | groq | auto (groq when a key is configured, else local). A cached transcript
    is reused as-is for auto, and only when it came from the same engine if one is named."""
    video = video.resolve()
    stat = video.stat()
    fp = {"size":stat.st_size,"mtime_ns":stat.st_mtime_ns}
    target = edit/"transcripts"/f"{video.stem}.json"
    if target.exists():
        data = json.loads(target.read_text(encoding="utf-8-sig"))
        if (data.get("fingerprint")==fp and data.get("source")==str(video)
                and engine in ("auto",data.get("engine","local"))):
            print(f"Cached: {target}")
            return target
    if engine=="auto":
        engine = "groq" if groq_key() else "local"
    if model_name not in ENGINE_MODELS[engine]:
        model_name = ENGINE_MODELS[engine][0]
    info = json.loads(capture(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(video)]).stdout)
    if not any(s["codec_type"]=="audio" for s in info["streams"]):
        raise ValueError(f"Refusing transcription: {video.name} has no audio stream")
    level = capture(["ffmpeg","-hide_banner","-nostats","-i",str(video),"-map","0:a:0",
                     "-vn","-af","volumedetect","-f","null","-"]).stderr
    match = re.search(r"max_volume:\s*([-\w.]+) dB",level)
    peak = float(match.group(1)) if match else None
    if peak is not None and not math.isfinite(peak):
        peak = None
    duration = float(info["format"]["duration"])
    if engine=="groq":
        words, language = groq_words(video,GROQ_MODELS[model_name],lang,duration)
    else:
        words, language = local_words(video,model_name,lang)
    silences, previous = [], 0.0
    for word in words:
        if word["s"]-previous >= .4:
            silences.append([round(previous,3),word["s"]])
        previous = max(previous,word["e"])
    if duration-previous >= .4:
        silences.append([round(previous,3),round(duration,3)])
    data = {"source":str(video),"fingerprint":fp,"duration":duration,"language":language,"engine":engine,
            "words":words,"silences":silences,"peak_dbfs":peak}
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary = target.with_suffix(".partial.json")
    temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf-8")
    temporary.replace(target)
    print(f"Saved {len(words)} words ({engine}/{model_name}): {target}")
    return target


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video",type=Path)
    ap.add_argument("--edit-dir",type=Path,required=True)
    ap.add_argument("--engine",choices=["auto","local","groq"],default="auto")
    ap.add_argument("--model",choices=sorted({m for ms in ENGINE_MODELS.values() for m in ms}),default=None,
                    help="local: medium|large-v3-turbo; groq: groq-large-v3 (default, best Arabic)|groq-turbo")
    ap.add_argument("--lang",choices=["ar","en","auto"],default="auto")
    a = ap.parse_args()
    transcribe_one(a.video,a.edit_dir,a.model,a.lang,a.engine)


if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (ValueError,OSError,subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
