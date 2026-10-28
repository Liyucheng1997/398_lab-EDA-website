`timescale 1ns / 1ps

// 虚拟开发板入门（Basys 3 布局）
//
// 在「虚拟开发板」中试试：
//   · 拨动 16 个开关 —— 正上方对应的 LED 跟着亮灭；
//   · 数码管用十六进制显示开关组成的 16 位数；
//   · 按住中键 BTNC —— 所有 LED 取反；
//   · 按住上键 BTNU —— 数码管改为显示上电后经过的秒数（十进制）；
//   · 按住下键 BTND —— 数码管熄灭；
//   · 最右边一位的小数点每秒闪一次，表示时钟在运行。
//
// 顶层端口名遵循虚拟开发板约定（clk / sw / btn / led / seg_n / an_n），
// 所以无需任何约束文件就能在浏览器中运行；下载到真实 Basys 3 时使用 basys3.xdc。
module virtual_starter #(
  parameter CLK_HZ  = 100_000_000,  // 输入时钟频率（Hz）
  parameter SCAN_HZ = 1_000         // 数码管每一位的切换频率（Hz）
) (
  input  logic        clk,
  input  logic [15:0] sw,
  input  logic [4:0]  btn,          // {BTND, BTNR, BTNL, BTNU, BTNC}
  output logic [15:0] led,
  output logic [7:0]  seg_n,        // {dp, g, f, e, d, c, b, a}，低电平点亮
  output logic [3:0]  an_n          // 位选，低电平有效
);
  localparam SEC_DIV  = (CLK_HZ > 1) ? CLK_HZ : 2;
  localparam HALF_SEC = (CLK_HZ / 2 > 1) ? CLK_HZ / 2 : 1;
  localparam SCAN_DIV = (CLK_HZ / SCAN_HZ > 1) ? CLK_HZ / SCAN_HZ : 1;
  localparam SW_      = $clog2(SEC_DIV);
  localparam CW       = (SCAN_DIV > 1) ? $clog2(SCAN_DIV) : 1;

  // ───────── 1. 开关 → LED（组合逻辑） ─────────
  assign led = btn[0] ? ~sw : sw;

  // ───────── 2. 秒计数（BCD 0000~9999）与心跳 ─────────
  logic [SW_-1:0] sec_cnt = '0;
  logic [15:0]    seconds = '0;   // 4 位 BCD
  logic           heart;

  always_ff @(posedge clk) begin
    if (sec_cnt == SW_'(SEC_DIV - 1)) begin
      sec_cnt <= '0;
      // BCD 加 1：低位到 9 就进位
      if (seconds[3:0] != 4'd9)        seconds[3:0]   <= seconds[3:0] + 4'd1;
      else begin
        seconds[3:0] <= 4'd0;
        if (seconds[7:4] != 4'd9)      seconds[7:4]   <= seconds[7:4] + 4'd1;
        else begin
          seconds[7:4] <= 4'd0;
          if (seconds[11:8] != 4'd9)   seconds[11:8]  <= seconds[11:8] + 4'd1;
          else begin
            seconds[11:8] <= 4'd0;
            seconds[15:12] <= (seconds[15:12] != 4'd9) ? seconds[15:12] + 4'd1 : 4'd0;
          end
        end
      end
    end else begin
      sec_cnt <= sec_cnt + 1'b1;
    end
  end

  assign heart = (sec_cnt < SW_'(HALF_SEC));   // 每秒前半段点亮

  // ───────── 3. 数码管动态扫描 ─────────
  logic [CW-1:0] scan_cnt = '0;
  logic [1:0]    digit    = '0;

  always_ff @(posedge clk) begin
    if (scan_cnt >= CW'(SCAN_DIV - 1)) begin
      scan_cnt <= '0;
      digit    <= digit + 2'd1;
    end else begin
      scan_cnt <= scan_cnt + 1'b1;
    end
  end

  logic [15:0] value;
  logic [3:0]  nibble;
  logic [6:0]  segs;          // {g, f, e, d, c, b, a}，高电平点亮
  logic        dp;

  assign value  = btn[1] ? seconds : sw;
  assign nibble = value[digit*4 +: 4];
  assign dp     = (digit == 2'd0) && heart;

  always_comb begin
    case (nibble)
      4'h0: segs = 7'b0111111;  4'h1: segs = 7'b0000110;
      4'h2: segs = 7'b1011011;  4'h3: segs = 7'b1001111;
      4'h4: segs = 7'b1100110;  4'h5: segs = 7'b1101101;
      4'h6: segs = 7'b1111101;  4'h7: segs = 7'b0000111;
      4'h8: segs = 7'b1111111;  4'h9: segs = 7'b1101111;
      4'hA: segs = 7'b1110111;  4'hB: segs = 7'b1111100;
      4'hC: segs = 7'b0111001;  4'hD: segs = 7'b1011110;
      4'hE: segs = 7'b1111001;  default: segs = 7'b1110001;
    endcase
  end

  assign an_n  = btn[4] ? 4'b1111 : ~(4'b0001 << digit);
  assign seg_n = ~{dp, segs};
endmodule
