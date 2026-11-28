--!strict

local Base85 = {}

function Base85.Encode(buf: buffer): string
    local len = buffer.len(buf)
    if len == 0 then return "" end

    local out = {}
    local outIdx = 1
    local remainder = len % 4

    for i = 0, len - 1, 4 do
        local b1 = buffer.readu8(buf, i)
        local b2 = (i + 1 < len) and buffer.readu8(buf, i + 1) or 0
        local b3 = (i + 2 < len) and buffer.readu8(buf, i + 2) or 0
        local b4 = (i + 3 < len) and buffer.readu8(buf, i + 3) or 0

        local val = b1 * 16777216 + b2 * 65536 + b3 * 256 + b4

        if val == 0 and (i + 3 < len) then
            out[outIdx] = "z"
            outIdx += 1
        else
            local c5 = val % 85
            val = math.floor(val / 85)
            local c4 = val % 85
            val = math.floor(val / 85)
            local c3 = val % 85
            val = math.floor(val / 85)
            local c2 = val % 85
            local c1 = math.floor(val / 85)

            out[outIdx] = string.char(c1 + 33, c2 + 33, c3 + 33, c4 + 33, c5 + 33)
            outIdx += 1
        end
    end

    local res = table.concat(out)

    if remainder > 0 then
        res = string.sub(res, 1, -(4 - remainder + 1))
    end

    return res
end

function Base85.Decode(str: string): buffer
    if #str == 0 then
        return buffer.create(0)
    end

    -- Just strip whitespace now
    str = (string.gsub(str, "%s", ""))

    local len = #str
    local tempBuf = buffer.create(len * 4)
    local offset = 0
    local i = 1

    while i <= len do
        local c = string.sub(str, i, i)

        if c == "z" then
            buffer.writeu8(tempBuf, offset, 0)
            buffer.writeu8(tempBuf, offset + 1, 0)
            buffer.writeu8(tempBuf, offset + 2, 0)
            buffer.writeu8(tempBuf, offset + 3, 0)
            offset += 4
            i += 1
        else
            local chunk = string.sub(str, i, i + 4)
            local chunkLen = #chunk

            if chunkLen == 1 then
                break
            end

            if chunkLen < 5 then
                chunk = chunk .. string.rep("u", 5 - chunkLen)
            end

            local v1, v2, v3, v4, v5 = string.byte(chunk, 1, 5)

            local val = (v1 - 33) * 52200625 +
                        (v2 - 33) * 614125 +
                        (v3 - 33) * 7225 +
                        (v4 - 33) * 85 +
                        (v5 - 33)

            local b1 = math.floor(val / 16777216) % 256
            local b2 = math.floor(val / 65536) % 256
            local b3 = math.floor(val / 256) % 256
            local b4 = val % 256

            buffer.writeu8(tempBuf, offset, b1)
            if chunkLen >= 3 then buffer.writeu8(tempBuf, offset + 1, b2) end
            if chunkLen >= 4 then buffer.writeu8(tempBuf, offset + 2, b3) end
            if chunkLen == 5 then buffer.writeu8(tempBuf, offset + 3, b4) end

            offset += (chunkLen - 1)
            i += chunkLen
        end
    end

    local finalBuf = buffer.create(offset)
    buffer.copy(finalBuf, 0, tempBuf, 0, offset)

    return finalBuf
end

return Base85