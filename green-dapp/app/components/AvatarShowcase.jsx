"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AVATAR_BACKGROUND_SLOT,
  AVATAR_SLOTS,
  getLayerZIndex,
  getSlotScaleX,
  getSlotScaleY,
} from "../lib/avatarConfig";

export default function AvatarShowcase({
  layout,
  size = 280,
  rounded = 24,
  background = "radial-gradient(900px 450px at 30% 10%, rgba(50,60,90,.35), rgba(15,20,35,.8))",
}) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch("/items/items.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setItems(Array.isArray(json) ? json : []))
      .catch(() => setItems([]));
  }, []);

  const character = layout?.character || layout?.equipped?.character || "girl";
  const equipped = layout?.equipped || {};
  const offsets = layout?.offsets || {};

  const itemMap = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const wallpaperItem = equipped?.[AVATAR_BACKGROUND_SLOT] ? itemMap.get(equipped[AVATAR_BACKGROUND_SLOT]) || null : null;
  const offsetScale = size / SHOWCASE_REFERENCE_SIZE;

  const layers = useMemo(() => {
    const base = character === "boy" ? "/avatars/base/boy.png" : "/avatars/base/girl.png";
    return [
      { slot: "base", src: base, z: 1 },
      ...AVATAR_SLOTS.map((slot) => ({
        slot,
        src: equipped[slot] ? itemMap.get(equipped[slot])?.image || null : null,
        item: equipped[slot] ? itemMap.get(equipped[slot]) || null : null,
        z: getLayerZIndex(slot),
      })),
    ];
  }, [character, equipped, itemMap]);

  function getOffset(slot) {
    const o = offsets?.[slot];
    if (o && (o.xPct !== undefined || o.yPct !== undefined)) {
      return {
        x: Number(o?.xPct || 0) * size,
        y: Number(o?.yPct || 0) * size,
      };
    }
    return {
      x: Number(o?.x || 0) * offsetScale,
      y: Number(o?.y || 0) * offsetScale,
    };
  }

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: rounded,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,.10)",
        background,
        boxShadow: "0 30px 90px rgba(0,0,0,.28)",
        flex: "0 0 auto",
      }}
    >
      {wallpaperItem?.image ? (
        <img
          src={wallpaperItem.image}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
            userSelect: "none",
            zIndex: 0,
          }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      {layers.map((layer) => {
        if (!layer.src) return null;
        const offset = getOffset(layer.slot);
        const scaleX = layer.slot === "base" ? 1 : getSlotScaleX(layer.slot, layer.item);
        const scaleY = layer.slot === "base" ? 1 : getSlotScaleY(layer.slot, layer.item);
        return (
          <div
            key={layer.slot}
            style={{
              position: "absolute",
              inset: 0,
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scaleX}, ${scaleY})`,
              transformOrigin: "50% 50%",
              zIndex: layer.z,
            }}
          >
            <img
              src={layer.src}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                pointerEvents: "none",
                userSelect: "none",
              }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

const SHOWCASE_REFERENCE_SIZE = 560;
